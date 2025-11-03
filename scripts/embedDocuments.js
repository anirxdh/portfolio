import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Configuration
const CHUNK_SIZE = 1000; // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks
const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100; // Pinecone upsert batch size

/**
 * Load and parse PDF file
 */
async function loadPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    console.log(`✓ Loaded PDF: ${path.basename(filePath)}`);
    console.log(`  Pages: ${data.numpages}`);
    console.log(`  Text length: ${data.text.length} characters`);
    return data.text;
  } catch (error) {
    console.error(`✗ Error loading PDF: ${error.message}`);
    throw error;
  }
}

/**
 * Split text into overlapping chunks
 */
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = start + chunkSize;
    const chunk = text.slice(start, end);
    
    if (chunk.trim().length > 0) {
      chunks.push({
        text: chunk.trim(),
        start,
        end: Math.min(end, text.length),
      });
    }

    start += chunkSize - overlap;
  }

  console.log(`✓ Created ${chunks.length} text chunks`);
  return chunks;
}

/**
 * Generate embeddings for text chunks
 */
async function generateEmbeddings(chunks) {
  console.log(`⏳ Generating embeddings for ${chunks.length} chunks...`);
  const embeddings = [];

  try {
    // Process in batches to avoid rate limits
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunk.text,
      });

      embeddings.push({
        id: `chunk-${i}`,
        values: response.data[0].embedding,
        metadata: {
          text: chunk.text,
          chunkIndex: i,
          startPos: chunk.start,
          endPos: chunk.end,
          source: 'portfolio-document',
        },
      });

      // Progress indicator
      if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
        console.log(`  Processed ${i + 1}/${chunks.length} chunks`);
      }

      // Rate limiting - small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✓ Generated ${embeddings.length} embeddings`);
    return embeddings;
  } catch (error) {
    console.error(`✗ Error generating embeddings: ${error.message}`);
    throw error;
  }
}

/**
 * Upsert vectors to Pinecone
 */
async function upsertToPinecone(vectors) {
  try {
    const indexName = process.env.PINECONE_INDEX_NAME;
    console.log(`⏳ Connecting to Pinecone index: ${indexName}`);

    const index = pinecone.index(indexName);

    // Upsert in batches
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, Math.min(i + BATCH_SIZE, vectors.length));
      
      await index.upsert(batch);
      
      console.log(`  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(vectors.length / BATCH_SIZE)}`);
    }

    // Get index stats
    const stats = await index.describeIndexStats();
    console.log(`✓ Successfully upserted ${vectors.length} vectors to Pinecone`);
    console.log(`  Total vectors in index: ${stats.totalRecordCount}`);
  } catch (error) {
    console.error(`✗ Error upserting to Pinecone: ${error.message}`);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting document embedding process...\n');

  // Check for required environment variables
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not found in environment variables');
  }
  if (!process.env.PINECONE_API_KEY) {
    throw new Error('PINECONE_API_KEY not found in environment variables');
  }
  if (!process.env.PINECONE_INDEX_NAME) {
    throw new Error('PINECONE_INDEX_NAME not found in environment variables');
  }

  // Look for PDF files in documents directory
  const documentsDir = path.join(__dirname, 'documents');
  const files = fs.readdirSync(documentsDir).filter(file => 
    file.endsWith('.pdf') && file !== '.gitkeep'
  );

  if (files.length === 0) {
    console.log('⚠️  No PDF files found in scripts/documents/');
    console.log('   Please add your portfolio PDF to scripts/documents/ and run again.');
    return;
  }

  console.log(`Found ${files.length} PDF file(s):\n`);
  
  for (const file of files) {
    const filePath = path.join(documentsDir, file);
    console.log(`\n📄 Processing: ${file}\n${'='.repeat(50)}`);

    try {
      // Step 1: Load PDF
      const text = await loadPDF(filePath);

      // Step 2: Chunk text
      const chunks = chunkText(text);

      // Step 3: Generate embeddings
      const embeddings = await generateEmbeddings(chunks);

      // Step 4: Upsert to Pinecone
      await upsertToPinecone(embeddings);

      console.log(`\n✅ Successfully processed ${file}\n`);
    } catch (error) {
      console.error(`\n❌ Failed to process ${file}: ${error.message}\n`);
    }
  }

  console.log('🎉 Embedding process complete!');
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

