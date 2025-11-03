import { generateEmbedding, streamChatCompletion } from './utils/openai.js';
import { queryVectorStore } from './utils/pinecone.js';

/**
 * Netlify serverless function for AI chat
 */
export const handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Parse request body
    const { message, conversationHistory = [] } = JSON.parse(event.body);

    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    console.log(`Received message: "${message.substring(0, 50)}..."`);

    // Step 1: Generate embedding for the user's question
    const embedding = await generateEmbedding(message);
    console.log('Generated embedding for query');

    // Step 2: Query Pinecone for relevant context
    const relevantContext = await queryVectorStore(embedding, 5);
    console.log(`Retrieved ${relevantContext.length} relevant chunks`);

    // Step 3: Build message history
    const messages = [
      ...conversationHistory.slice(-6), // Keep last 3 exchanges
      { role: 'user', content: message },
    ];

    // Step 4: Get streaming response from OpenAI
    const stream = await streamChatCompletion(messages, relevantContext);

    // Step 5: Stream the response back to client
    let fullResponse = '';
    
    // Collect the stream
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
    }

    // Return the complete response
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        response: fullResponse,
        contextsUsed: relevantContext.length,
      }),
    };
  } catch (error) {
    console.error('Error in chat function:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process chat request',
        message: error.message,
      }),
    };
  }
};

