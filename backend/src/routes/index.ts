import express from 'express';
import multer from 'multer';
import { ConversionController } from '../controllers/conversionController';
import { HuggingFaceController } from '../controllers/huggingfaceController';
import { EvaluationController } from '../controllers/evaluationController';
import {
  startTraining,
  getActiveTrainingJobs,
  getTrainingStatus,
  streamTrainingStatus,
  stopTraining,
  getSystemResources,
  resumeTraining,
} from '../controllers/trainController';
import {
  saveTrainingHistory,
  getTrainingHistoryList,
  getTrainingHistoryDetail,
  deleteTrainingHistory,
  getDistinctBaseModels,
} from '../controllers/trainingHistoryController';
import { chatWithAI, inferWithAI, chatWithAIStream, inferWithAIStream, saveChatHistory, getChatHistory, loadModel, getInferenceLogs, validateModel } from '../controllers/chatController';
import {
  getSessions,
  getSessionById,
  createSession,
  appendMessageToSession,
  deleteSession
} from '../controllers/chatSessionController';
import { clusterData, clusterFilter, deleteClusterCache, clusterVisualize } from '../controllers/clusterController';
import { ModelRegistryController } from '../controllers/modelRegistryController';


import {
  runEvaluation,
  streamEvalStatus,
  saveEvalResult,
  getEvaluation,
  getEvaluatedModels,
  getEvalHistory,
  pinEvaluation,
  deleteEvaluation,
  compareEvaluations,
  getGpuStatusEndpoint,
  reviewConversation
} from '../controllers/evalModelController';


const router = express.Router();
const controller = new ConversionController();
const hfController = new HuggingFaceController();
const evalController = new EvaluationController();
const registryController = new ModelRegistryController();

// Cấu hình multer cho upload
// Cấu hình multer cho upload
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    // Thêm các định dạng phổ biến cho Machine Learning: .json, .jsonl, .csv, .txt
    const allowedMimeTypes = ['application/json', 'text/csv', 'text/plain', 'application/octet-stream'];
    const allowedExtensions = ['.json', '.jsonl', '.csv', '.txt'];

    const isMimeTypeValid = allowedMimeTypes.includes(file.mimetype);
    const isExtensionValid = allowedExtensions.some(ext => file.originalname.endsWith(ext));

    if (isMimeTypeValid || isExtensionValid) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON, JSONL, CSV, and TXT files are allowed for training data.'));
    }
  },
});

// Conversion Routes
router.post('/upload', upload.single('file'), (req, res) => controller.uploadFile(req, res));
router.post('/convert', (req, res) => controller.convertData(req, res));
router.get('/stats/:fileId', (req, res) => controller.getStats(req, res));
router.get('/preview/:fileId', (req, res) => controller.previewData(req, res));
router.delete('/file/:fileId', (req, res) => controller.deleteFile(req, res));

// Chat Route
router.post('/chat', chatWithAI);
router.post('/infer', inferWithAI);
router.post('/chat/stream', chatWithAIStream);
router.post('/infer/stream', inferWithAIStream);
router.post('/chat/validate-model', validateModel);
router.get('/infer/logs', getInferenceLogs);
router.post('/model/load', loadModel);
router.post('/chat/history', saveChatHistory);
router.get('/chat/history', getChatHistory);

// Chat Session Routes
router.get('/chat/sessions', getSessions);
router.get('/chat/sessions/:id', getSessionById);
router.post('/chat/sessions', createSession);
router.put('/chat/sessions/:id', appendMessageToSession);
router.delete('/chat/sessions/:id', deleteSession);


// Hugging Face Routes
router.post('/huggingface/upload', (req, res) => hfController.uploadDataset(req, res));

// Gemini Evaluation
router.post('/evaluate', (req, res) => evalController.evaluate(req, res));
router.post('/evaluate/refine', (req, res) => evalController.refine(req, res));
router.post('/evaluate/save', (req, res) => evalController.saveEvaluation(req, res));
router.get('/evaluate/history', (req, res) => evalController.getEvaluationHistory(req, res));
router.patch('/evaluate/history/:id', (req, res) => evalController.updateEvaluationHistory(req, res));
router.post('/dataset-versions/create', (req, res) => evalController.createDatasetVersion(req, res));
router.get('/dataset-versions/:id', (req, res) => evalController.getDatasetVersionDetail(req, res));
router.delete('/dataset-versions/items/:sampleId', (req, res) => evalController.deleteDatasetVersionSample(req, res));

// Clustering Route (proxy to Python K-means on Colab via GPU_SERVICE_URL)
router.post('/cluster/visualize', clusterVisualize);
router.post('/cluster', clusterData);
router.post('/cluster/filter', clusterFilter);
router.delete('/cluster/cache', deleteClusterCache);

// Training Routes
router.post('/train/start', upload.single('dataset_file'), startTraining);
router.get('/train/active', getActiveTrainingJobs);
router.get('/train/status/:jobId', getTrainingStatus);
router.get('/train/stream/:jobId', streamTrainingStatus);
router.post('/train/stop/:jobId', stopTraining);
router.post('/train/resume/:jobId', resumeTraining);
router.get('/system/resources', getSystemResources);

// Training History Routes  (⚠️ /models MUST come before /:jobId)
router.get('/train/history/models', getDistinctBaseModels);
router.post('/train/history', saveTrainingHistory);
router.get('/train/history', getTrainingHistoryList);
router.get('/train/history/:jobId', getTrainingHistoryDetail);
router.delete('/train/history/:jobId', deleteTrainingHistory);

// Model Eval Routes
router.patch('/model-eval/:evalId/review/:convIndex', reviewConversation);
router.get('/model-eval/gpu-status', getGpuStatusEndpoint);  // ⚠️ trước wildcard
router.get('/model-eval/leaderboard', getEvaluatedModels);
router.post('/model-eval/run/:jobId', upload.single('eval_file'), runEvaluation);
router.get('/model-eval/stream/:evalJobId', streamEvalStatus);
router.post('/model-eval/save', saveEvalResult);
router.get('/model-eval/history/:jobId', getEvalHistory);
router.post('/model-eval/pin/:evalId', pinEvaluation);         // ⚠️ phải đứng trước /:evalId
router.get('/model-eval/compare', compareEvaluations);         // ⚠️ trước GET /:evalId
router.delete('/model-eval/:evalId', deleteEvaluation);        // ⚠️ trước GET /:evalId
router.get('/model-eval/:evalId', getEvaluation);              // ⚠️ wildcard — đứng cuối cùng

// Model Registry Routes
router.get('/model-registry', (req, res) => registryController.listRegistries(req, res));
router.post('/model-registry', (req, res) => registryController.createRegistry(req, res));
router.get('/model-registry/:id', (req, res) => registryController.getRegistry(req, res));
router.put('/model-registry/:id', (req, res) => registryController.updateRegistry(req, res));
router.delete('/model-registry/:id', (req, res) => registryController.deleteRegistry(req, res));

// Model Version Routes
router.get('/model-registry/:registryId/versions', (req, res) => registryController.listVersions(req, res));
router.post('/model-versions', (req, res) => registryController.registerVersion(req, res));
router.put('/model-versions/:id/status', (req, res) => registryController.updateVersionStatus(req, res));
router.delete('/model-versions/:id', (req, res) => registryController.deleteVersion(req, res));
router.get('/model-versions/evaluations/:jobId', (req, res) => registryController.getEvaluationsByJob(req, res));
router.get('/model-versions/download-dataset/:id', (req, res) => registryController.downloadDataset(req, res));
router.get('/model-registry/:registryId/production', (req, res) => registryController.getProductionVersion(req, res));

export default router;