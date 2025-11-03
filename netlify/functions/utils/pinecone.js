import { Pinecone } from '@pinecone-database/pinecone';

let pineconeClient = null;
let pineconeIndex = null;

/**
 * Initialize Pinecone client (singleton pattern)
 */
function initPinecone() {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    pineconeIndex = pineconeClient.index(process.env.PINECONE_INDEX_NAME);
  }

  return { client: pineconeClient, index: pineconeIndex };
}

/**
 * Query Pinecone vector store for relevant context
 */
export async function queryVectorStore(embedding, topK = 5) {
  try {
    const { index } = initPinecone();

    const queryResponse = await index.query({
      vector: embedding,
      topK,
      includeMetadata: true,
    });

    // Extract and format matches
    const matches = queryResponse.matches
      .filter(match => match.score > 0.7) // Only include relevant matches
      .map(match => ({
        text: match.metadata?.text || '',
        score: match.score,
        chunkIndex: match.metadata?.chunkIndex,
        source: match.metadata?.source,
      }));

    console.log(`Found ${matches.length} relevant matches from Pinecone`);

    return matches;
  } catch (error) {
    console.error('Error querying Pinecone:', error);
    
    // Return empty array on error to allow fallback to general knowledge
    return [];
  }
}

/**
 * Check Pinecone connection and index stats
 */
export async function checkPineconeHealth() {
  try {
    const { index } = initPinecone();
    const stats = await index.describeIndexStats();
    
    return {
      healthy: true,
      totalVectors: stats.totalRecordCount,
      dimension: stats.dimension,
    };
  } catch (error) {
    console.error('Pinecone health check failed:', error);
    return {
      healthy: false,
      error: error.message,
    };
  }
}

