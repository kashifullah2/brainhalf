import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import fs from "fs";
import path from "path";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
  return env;
}

const env = loadEnv();
const accessKeyId = (env.VITE_AWS_ACCESS_KEY_ID || "").trim();
const secretAccessKey = (env.VITE_AWS_SECRET_ACCESS_KEY || "").trim();
const region = (env.VITE_AWS_REGION || "us-east-1").trim();

console.log("=== Testing AWS Textract with Real Sample Document ===");

async function main() {
  // Fetch a real sample document image (a public invoice/receipt JPEG)
  const imgUrl = "https://raw.githubusercontent.com/tesseract-ocr/test/main/testing/phototest.tif"; 
  // Let's fetch a standard jpeg from wikipedia
  const sampleUrl = "https://picsum.photos/400/300.jpg";
  
  console.log(`Downloading sample document from: ${sampleUrl}...`);
  const resp = await fetch(sampleUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!resp.ok) {
    console.error("Failed to download sample image:", resp.statusText);
    return;
  }
  const arrayBuffer = await resp.arrayBuffer();
  const imageBytes = new Uint8Array(arrayBuffer);
  console.log(`Downloaded image size: ${imageBytes.length} bytes`);

  const client = new TextractClient({
    region,
    credentials: { accessKeyId, secretAccessKey }
  });

  const command = new DetectDocumentTextCommand({
    Document: { Bytes: imageBytes }
  });

  try {
    console.log(`Sending DetectDocumentTextCommand to region ${region}...`);
    const result = await client.send(command);
    console.log(`\n🎉 SUCCESS! AWS Textract connected and processed successfully!`);
    console.log(`HTTP Status: ${result.$metadata.httpStatusCode}`);
    console.log(`Blocks Found: ${result.Blocks?.length || 0}`);
    
    const lines = (result.Blocks || [])
      .filter(b => b.BlockType === "LINE")
      .map(b => b.Text);
    
    console.log("\nSample Extracted Lines (First 5):");
    lines.slice(0, 5).forEach((line, idx) => console.log(` ${idx + 1}. ${line}`));
  } catch (err) {
    console.error("\n❌ Textract Error:");
    console.error(`  Name: ${err.name}`);
    console.error(`  Message: ${err.message}`);
    console.error(`  HTTP Status: ${err.$metadata?.httpStatusCode}`);
  }
}

main();
