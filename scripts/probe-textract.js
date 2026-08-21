import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import fs from "fs";
import path from "path";

const accessKeyId = process.env.VITE_AWS_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.VITE_AWS_SECRET_ACCESS_KEY || "";

const client = new TextractClient({
  region: "us-east-1",
  credentials: {
    accessKeyId,
    secretAccessKey
  }
});

// Create a simple text file, no wait, we need an image.
// Let's just catch the exact error.
const imageBytes = fs.readFileSync("package.json");

const command = new DetectDocumentTextCommand({
  Document: { Bytes: imageBytes }
});

client.send(command)
  .then(res => console.log("Success:", !!res.Blocks))
  .catch(err => console.error("Textract Error:", err.name, err.message));
