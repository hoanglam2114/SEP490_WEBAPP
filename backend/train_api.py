import os 
import threading 
import time 
import pynvml 
from flask import Flask, request, jsonify, Response 
from pyngrok import ngrok 
from werkzeug.utils import secure_filename 
import datetime 
import torch # Import torch for VRAM management 
from threading import Thread 
import json 


# --- THƯ VIỆN AI --- 
from unsloth import FastLanguageModel, is_bfloat16_supported 
from datasets import load_dataset 
from trl import SFTTrainer 
from transformers import TrainingArguments, TrainerCallback, TextIteratorStreamer 
from huggingface_hub import login, HfApi, snapshot_download 
from google.colab import userdata 


# 0. CÀI ĐẶT MÔI TRƯỜNG (BỎ GOOGLE DRIVE HOÀN TOÀN) 
os.environ["TORCHDYNAMO_DISABLE"] = "1" 


app = Flask(__name__) 
UPLOAD_FOLDER = os.path.abspath('./dataset_uploads')
LOCAL_CHECKPOINT_BASE = os.path.abspath("./local_checkpoints") # Sử dụng đường dẫn tuyệt đối
 
os.makedirs(UPLOAD_FOLDER, exist_ok=True) 
os.makedirs(LOCAL_CHECKPOINT_BASE, exist_ok=True) 
 
jobs_db = {} 
stop_flags = {} # Cờ để dừng training chủ động
pynvml.nvmlInit() 
gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0) 


# Biến toàn cục để theo dõi model/tokenizer đang được load cho inference 
_current_infer_model = None 
_current_infer_tokenizer = None 


# Hàm giải phóng bộ nhớ GPU 
def _release_gpu_memory(): 
    global _current_infer_model, _current_infer_tokenizer 
    if _current_infer_model is not None: 
        del _current_infer_model 
        _current_infer_model = None 
    if _current_infer_tokenizer is not None: 
        del _current_infer_tokenizer 
        _current_infer_tokenizer = None 
    torch.cuda.empty_cache() 
    print("\n--- GPU memory released ---\n") 


# ====================================================================== 
# 1. CUSTOM CALLBACK: Log Tiến độ & Checkpoint 
# ====================================================================== 
class FlaskProgressCallback(TrainerCallback): 
    def __init__(self, job_id): 
        self.job_id = job_id 


    def on_log(self, args, state, control, logs=None, **kwargs): 
        if logs and "loss" in logs: 
            loss_val = round(logs["loss"], 4) 
            epoch_val = round(state.epoch or 0, 2) 


            jobs_db[self.job_id].update({ 
                'loss': loss_val, 
                'epoch': epoch_val, 
                'progress': round((state.global_step / state.max_steps) * 100, 2) if state.max_steps > 0 else 0 
            }) 


            log_line = f"Step {state.global_step} | Epoch {epoch_val} | Loss: {loss_val:.4f}" 
            if 'logs' not in jobs_db[self.job_id]: jobs_db[self.job_id]['logs'] = [] 
            jobs_db[self.job_id]['logs'].append(log_line) 


    def on_save(self, args, state, control, **kwargs): 
        checkpoint_msg = f"💾 Checkpoint saved at step {state.global_step} and pushed to Hugging Face." 
        if 'logs' not in jobs_db[self.job_id]: jobs_db[self.job_id]['logs'] = [] 
        jobs_db[self.job_id]['logs'].append(checkpoint_msg) 


last_heartbeat = time.time() 


def formatting_prompts_func(examples): 
    instructions = examples["instruction"] 
    outputs      = examples["output"] 
    texts = [] 
    for instruction, output in zip(instructions, outputs): 
        text = f"### Instruction:\n{instruction}\n\n### Response:\n{output}" + " <|endoftext|>" 
        texts.append(text) 
    return { "text" : texts, } 


class WatchdogCallback(TrainerCallback): 
    def __init__(self, job_id):
        self.job_id = job_id

    def on_step_end(self, args, state, control, **kwargs): 
        # Dừng theo yêu cầu từ API Stop
        if stop_flags.get(self.job_id):
            print(f"🛑 [Job {self.job_id}] Stop flag detected. Stopping...")
            control.should_training_stop = True
            return

        # Dừng theo Watchdog (mất kết nối)
        if time.time() - last_heartbeat > 60: # Tăng lên 60s cho ổn định
            print(f"⚠️ Watchdog: No heartbeat detected for {self.job_id}. Stopping...") 
            control.should_training_stop = True 


# ====================================================================== 
# 2. LÕI HUẤN LUYỆN (CORE TRAINING) 
# ====================================================================== 
def background_train_task(job_id, config, filepath): 
    jobs_db[job_id]['status'] = 'RUNNING' 
    local_job_dir = os.path.join(LOCAL_CHECKPOINT_BASE, job_id) 
    
    # Ưu tiên lấy repo checkpoint từ lệnh Resume, nếu không có thì dùng repo mặc định
    hf_repo_id = config.get('checkpoint_hf_repo') or config.get('hf_repo_id')


    try: 
        if not hf_repo_id: 
            raise ValueError("Lỗi: Không tìm thấy hf_repo_id. Vui lòng gửi kèm từ Backend!") 


        # Đăng nhập Hugging Face 
        print("🔑 Đang đăng nhập Hugging Face...") 
        hf_token = userdata.get('HF_TOKEN') 
        login(token=hf_token) 


        _release_gpu_memory() 


        # 2.1. Tải Mô hình 
        model, tokenizer = FastLanguageModel.from_pretrained( 
            model_name = config['model_name'], 
            max_seq_length = config['modelMaxLength'], 
            load_in_4bit = True, 
        ) 


        if getattr(tokenizer, "pad_token", None) is None: 
            tokenizer.pad_token = tokenizer.eos_token 
        tokenizer.padding_side = "right" 


        # 2.2. Gắn LoRA 
        model = FastLanguageModel.get_peft_model( 
            model, 
            r = config['r'], 
            target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"], 
            lora_alpha = config['lora_alpha'], 
            lora_dropout = config['lora_dropout'], 
            bias = "none", 
            use_gradient_checkpointing = "unsloth", 
            random_state = config['random_state'], 
        ) 


        # 2.3. Xử lý Dataset 
        if filepath: 
            ext = os.path.splitext(filepath)[1] 
            dataset = load_dataset('json' if 'json' in ext else 'csv', data_files=filepath, split='train') 
        else: 
            dataset = load_dataset(config['dataset_hf_id'], split='train') 


        dataset = dataset.train_test_split(test_size=0.1, seed=42) 
        dataset_train = dataset["train"].map(formatting_prompts_func, batched=True) 
        dataset_eval  = dataset["test"].map(formatting_prompts_func, batched=True) 


        # 2.4. LOGIC RESUME TỪ HUGGING FACE (Cải tiến)
        api = HfApi() 
        resume_from = None 
        
        def is_valid_checkpoint(path):
            return os.path.exists(os.path.join(path, "trainer_state.json"))

        # Bước 1: Kiểm tra checkpoint cục bộ trước (Trường hợp dừng/resume trên cùng 1 session Colab)
        if os.path.exists(local_job_dir):
            checkpoints = [d for d in os.listdir(local_job_dir) if d.startswith("checkpoint-")]
            if checkpoints:
                # Sắp xếp theo số step để lấy cái mới nhất
                checkpoints.sort(key=lambda x: int(x.split("-")[1]), reverse=True)
                for ckpt in checkpoints:
                    ckpt_path = os.path.join(local_job_dir, ckpt)
                    if is_valid_checkpoint(ckpt_path):
                        resume_from = ckpt_path
                        print(f"[✅] Tìm thấy checkpoint CỤC BỘ hợp lệ: {ckpt}. Sẽ chạy tiếp từ đây.")
                        break

        # Bước 2: Nếu không có local, thử tải từ Hugging Face
        if not resume_from and hf_repo_id:
            try: 
                repo_files = api.list_repo_files(repo_id=hf_repo_id) 
                if any("checkpoint-" in f for f in repo_files): 
                    print(f"[🔄] Tìm thấy checkpoint trên Hugging Face. Đang tải về...") 
                    snapshot_download(
                        repo_id=hf_repo_id, 
                        local_dir=local_job_dir, 
                        local_dir_use_symlinks=False,
                        allow_patterns=["checkpoint-*/*", "*.json", "README.md"]
                    )
                    # Sau khi tải xong, tìm lại trong thư mục vừa tải
                    checkpoints = [d for d in os.listdir(local_job_dir) if d.startswith("checkpoint-")]
                    if checkpoints:
                        checkpoints.sort(key=lambda x: int(x.split("-")[1]), reverse=True)
                        for ckpt in checkpoints:
                            ckpt_path = os.path.join(local_job_dir, ckpt)
                            if is_valid_checkpoint(ckpt_path):
                                resume_from = ckpt_path
                                print(f"[✅] Đã tải xong từ Hub. Sẽ resume từ: {resume_from}")
                                break
            except Exception as e: 
                print(f"[*] Không thể tải checkpoint từ Hub hoặc chưa có: {e}") 

        if not resume_from:
            print("[*] Không tìm thấy checkpoint nào có trainer_state.json. Bắt đầu Train từ đầu.")


        # 2.5. Cấu hình Trainer & Checkpoint 
        trainer = SFTTrainer( 
            model = model, 
            tokenizer = tokenizer, 
            train_dataset = dataset_train, 
            dataset_text_field = "text", 
            eval_dataset = dataset_eval, 
            max_seq_length = config['modelMaxLength'], 
            args = TrainingArguments( 
                per_device_train_batch_size = config['batchSize'], 
                gradient_accumulation_steps = config['gradient_accumulation_steps'], 
                warmup_steps = config['warmup_steps'], 
                num_train_epochs = config['epochs'], 
                learning_rate = config['learningRate'], 
                fp16 = not is_bfloat16_supported(), 
                bf16 = is_bfloat16_supported(), 
                logging_steps = 1, 
                optim = config['optim'], 
                weight_decay = config['weight_decay'], 
                lr_scheduler_type = config['lr_scheduler_type'], 
                seed = config['seed'], 
                
                output_dir = local_job_dir, 
                save_strategy = "steps", 
                save_steps = 10, # Giảm xuống 10 để resume mượt hơn
                save_total_limit = 2, # Giữ 2 checkpoint gần nhất
                push_to_hub = True,             # TỰ ĐỘNG ĐẨY LÊN HUB 
                hub_model_id = hf_repo_id,      # TÊN REPO 
                hub_strategy = "checkpoint",    # ĐẨY MỖI KHI SAVE CHECKPOINT 
                hub_private = True,             # GIỮ PRIVATE REPO 
                report_to = "none", 
            ), 
            callbacks=[FlaskProgressCallback(job_id), WatchdogCallback(job_id)] 
        ) 


        # 2.6. Chạy Train 
        trainer.train(resume_from_checkpoint = resume_from) 


        # 2.7. Lưu Model cuối thẳng lên Hugging Face 
        print(f"[🚀] Train xong! Đang đẩy Final Model lên repo: {hf_repo_id}...") 
        model.push_to_hub(hf_repo_id, private=True) 
        tokenizer.push_to_hub(hf_repo_id, private=True) 


        jobs_db[job_id].update({'status': 'COMPLETED', 'progress': 100, 'final_path': hf_repo_id}) 


    except Exception as e: 
        print(f"[❌] Error: {str(e)}") 
        jobs_db[job_id].update({'status': 'ERROR', 'error': str(e)}) 
    finally: 
        _release_gpu_memory() 


# ====================================================================== 
# 3. API ENDPOINTS 
# ====================================================================== 
@app.route('/api/train/start', methods=['POST']) 
def start_training(): 
    print(f"[DEBUG] form data keys: {list(request.form.keys())}") 
    if request.files: 
        print(f"[DEBUG] files keys: {list(request.files.keys())}")

    config_raw = request.form.get('config')
    if config_raw:
        try:
            config = json.loads(config_raw)
            # ÉP KIỂU SỐ CHO CÁC THAM SỐ QUAN TRỌNG (Tránh lỗi so sánh str và int khi Resume)
            numeric_fields = {
                'epochs': int, 'batchSize': int, 'learningRate': float, 
                'modelMaxLength': int, 'r': int, 'lora_alpha': int, 
                'lora_dropout': float, 'random_state': int, 
                'gradient_accumulation_steps': int, 'warmup_steps': int, 
                'weight_decay': float, 'seed': int
            }
            for field, type_func in numeric_fields.items():
                if field in config:
                    try:
                        config[field] = type_func(config[field])
                    except:
                        pass # Giữ nguyên nếu không thể ép kiểu

            job_id = config.get('job_id')
            print(f"[INFO] Nhận config từ JSON field. Job ID: {job_id}")
        except json.JSONDecodeError as e:
            return jsonify({"error": f"Invalid JSON in 'config' field: {e}"}), 400
    else:
        print("[INFO] Không có trường 'config', đọc dữ liệu form riêng lẻ.")
        job_id = request.form.get('job_id')
        config = {
            'model_name': request.form.get('model_name', "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"),
            'epochs': int(request.form.get('epochs', 1)),
            'batchSize': int(request.form.get('batchSize', 2)),
            'learningRate': float(request.form.get('learningRate', 2e-4)),
            'modelMaxLength': int(request.form.get('modelMaxLength', 2048)),
            'r': int(request.form.get('r', 16)),
            'lora_alpha': int(request.form.get('lora_alpha', 16)),
            'lora_dropout': float(request.form.get('lora_dropout', 0)),
            'random_state': int(request.form.get('random_state', 3407)),
            'gradient_accumulation_steps': int(request.form.get('gradient_accumulation_steps', 4)),
            'warmup_steps': int(request.form.get('warmup_steps', 5)),
            'dataset_hf_id': request.form.get('dataset_hf_id'),
            'hf_repo_id': request.form.get('hf_repo_id'),
            # Bổ sung các key còn thiếu
            'optim': request.form.get('optim', 'adamw_8bit'),
            'weight_decay': float(request.form.get('weight_decay', 0.01)),
            'lr_scheduler_type': request.form.get('lr_scheduler_type', 'linear'),
            'seed': int(request.form.get('seed', 3407)),
        }

    if not job_id:
        return jsonify({"error": "Missing job_id in form data or in 'config' field"}), 400

    file_path = None
    # Kiểm tra cả 'dataset_file' (từ client) và 'file' (từ backend proxy)
    file = request.files.get('dataset_file') or request.files.get('file')
    if file and file.filename:
        file_path = os.path.join(UPLOAD_FOLDER, f"{job_id}_{secure_filename(file.filename)}")
        file.save(file_path)
        print(f"[INFO] Đã lưu file upload vào: {file_path}")

    jobs_db[job_id] = {'status': 'PENDING', 'progress': 0, 'logs': []}
    threading.Thread(target=background_train_task, args=(job_id, config, file_path)).start()

    return jsonify({"message": "Job started", "job_id": job_id}), 201


@app.route('/api/train/status/<job_id>') 
def get_status(job_id): 
    global last_heartbeat 
    last_heartbeat = time.time() 
    return jsonify(jobs_db.get(job_id, {"status": "NOT_FOUND"})), 200 


@app.route('/api/train/stop/<job_id>', methods=['POST'])
def stop_training_api(job_id):
    if job_id in jobs_db:
        stop_flags[job_id] = True
        return jsonify({"message": f"Stop flag set for job {job_id}"}), 200
    return jsonify({"error": "Job not found"}), 404


# Hàm format cho API Stream 
def format_inference_prompt(system_prompt, instruction): 
    return f"### Instruction:\n{system_prompt}\n{instruction}\n\n### Response:" 


@app.route('/api/infer/stream', methods=['POST']) 
def infer_model_stream(): 
    global _current_infer_model, _current_infer_tokenizer 


    data = request.json 
    hf_model_id = data.get('hf_model_id') 
    text_input = data.get('text_input') 
    system_prompt = data.get('system_prompt', "Bạn là một trợ lý AI hữu ích.") # Thêm default prompt


    if not hf_model_id or not text_input: 
        return jsonify({"error": "Missing hf_model_id or text_input"}), 400 


    try: 
        # Cập nhật login Hugging Face để load được repo Private 
        hf_token = userdata.get('HF_TOKEN') 
        login(token=hf_token) 


        if _current_infer_model is None or _current_infer_tokenizer is None or _current_infer_model.config._name_or_path != hf_model_id: 
            _release_gpu_memory() 
            print(f"Loading model {hf_model_id} for inference...") 


            _current_infer_model, _current_infer_tokenizer = FastLanguageModel.from_pretrained( 
                model_name = hf_model_id, 
                max_seq_length = 2048, 
                load_in_4bit = True, 
            ) 


            if getattr(_current_infer_tokenizer, "pad_token", None) is None: 
                _current_infer_tokenizer.pad_token = _current_infer_tokenizer.eos_token 
            _current_infer_tokenizer.padding_side = "right" 
        else: 
            print(f"Model {hf_model_id} already loaded. Reusing...") 


        instruction_text = format_inference_prompt(system_prompt, text_input) 
        inputs = _current_infer_tokenizer([instruction_text], return_tensors="pt").to("cuda") 


        streamer = TextIteratorStreamer(_current_infer_tokenizer, skip_prompt=True, skip_special_tokens=True) 


        generation_kwargs = dict( 
            **inputs, 
            streamer=streamer, 
            max_new_tokens=256, 
            do_sample=True, 
            temperature=0.7, 
            top_k=50, 
            top_p=0.95, 
            repetition_penalty=1.05, 
            eos_token_id=_current_infer_tokenizer.eos_token_id, 
        ) 


        thread = Thread(target=_current_infer_model.generate, kwargs=generation_kwargs) 
        thread.start() 


        def generate_stream(): 
            for new_text in streamer: 
                yield f"data: {json.dumps({'text': new_text})}\n\n" 
            yield "data: [DONE]\n\n" 


        return Response(generate_stream(), mimetype='text/event-stream') 


    except Exception as e: 
        _release_gpu_memory() 
        return jsonify({"error": str(e)}), 500 


@app.route('/api/system/resources') 
def get_resources(): 
    info = pynvml.nvmlDeviceGetMemoryInfo(gpu_handle) 
    util = pynvml.nvmlDeviceGetUtilizationRates(gpu_handle) 
    return jsonify({ 
        "vram_used_mb": info.used // 1024**2, 
        "vram_total_mb": info.total // 1024**2, 
        "gpu_util": util.gpu 
    }), 200 


if __name__ == '__main__': 
    NGROK_TOKEN = "3AWXtLfWJup5YftwfNfjLkupquU_5SectNPsmTQDMkjBKR7hK" 
    ngrok.set_auth_token(NGROK_TOKEN) 


    print("🔄 Đang khởi động hệ thống Ngrok...") 
    try: 
        tunnels = ngrok.get_tunnels() 
        for t in tunnels: 
            ngrok.disconnect(t.public_url) 


        os.system("pkill -f ngrok") 
        time.sleep(1) 


        public_url = ngrok.connect(5000).public_url 
        print("="*50) 
        print(f"🚀 NGROK URL: {public_url}") 
        print("="*50) 


        app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False) 


    except Exception as e: 
        print(f"❌ Lỗi khởi động: {e}")
