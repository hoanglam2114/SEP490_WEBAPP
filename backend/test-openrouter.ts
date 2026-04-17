import { OpenRouterProvider } from './src/services/providers/OpenRouterProvider';
import dotenv from 'dotenv';

dotenv.config();

async function testOpenRouter() {
  console.log('--- Testing OpenRouterProvider ---');
  
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    console.error('❌ Error: OPENROUTER_API_KEY is still a placeholder or missing in .env');
    return;
  }
  console.log(`Key loaded: ${apiKey.substring(0, 4)}****`);
  
  const provider = new OpenRouterProvider();
  const testPrompt = 'Say hello in 3 words';
  
  try {
    console.log('Sending request to OpenRouter...');
    // We use a simple prompt. Note: OpenRouterProvider expects to return a JSON array 
    // because it is currently configured for evaluation formatting in the system prompt.
    // For a simple chat test, let's see what it returns.
    const response = await provider.generateContent(testPrompt);
    
    console.log('Response from OpenRouter:');
    console.log(response);
    
    if (response) {
      console.log('✅ Test Passed!');
    } else {
      console.log('❌ Test Failed: Empty response');
    }
  } catch (error: any) {
    console.error('❌ Test Failed with error:');
    console.error(error.message);
    if (error.message.includes('OPENROUTER_API_KEY is missing')) {
      console.log('👉 Tip: Make sure to add OPENROUTER_API_KEY to your backend/.env file');
    }
  }
}

testOpenRouter();
