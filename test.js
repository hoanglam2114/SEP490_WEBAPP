(async () => {
  const url = 'https://nonelucidating-constrictingly-zackary.ngrok-free.dev/api/infer/stream';
  const data = {
    hf_model_id: 'Duandd/Qwen3-0.6B-test',
    text_input: 'ping'
  };
  console.log('Fetching', url);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(data)
    });
    console.log('Status:', r.status);
    const text = await r.text();
    console.log('Body:', text);
  } catch (e) {
    console.error(e);
  }
})();
