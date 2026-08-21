import React from "react";
import { LegalLayout } from "./LegalLayout";

export default function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service">
      <h2>1. Acceptance of Terms</h2>
      <p>By accessing and using the BrainHalf OCR platform ("the Service"), you agree to be bound by these Terms of Service. If you do not agree with any of these terms, you are prohibited from using or accessing this site.</p>

      <h2>2. Use License</h2>
      <p>Permission is granted to temporarily access the Service for personal and commercial data extraction purposes. Under this license you may not:</p>
      <ul>
        <li>Modify or copy the source code of the platform;</li>
        <li>Attempt to decompile or reverse engineer any software contained on BrainHalf;</li>
        <li>Remove any copyright or other proprietary notations from the materials;</li>
        <li>Use the Service for any illegal activities or to extract sensitive PII/HIPAA data without authorization.</li>
      </ul>

      <h2>3. Core Data Privacy Commitments</h2>
      <p>By utilizing the Service, you entrust us with your data, and we bind ourselves to the following commitments:</p>
      <ul>
        <li><strong>No Data Misuse:</strong> We process your documents and information strictly for the purpose of providing the OCR extraction services you have requested. We do not engage in unauthorized access, secondary processing, or any form of misuse of your confidential data.</li>
        <li><strong>No Data Selling or Unauthorized Sharing:</strong> Your personal information and uploaded documents are strictly confidential. We do not sell, rent, license, or distribute your data to third-party data brokers or marketing agencies under any circumstances without your explicit, opt-in consent.</li>
        <li><strong>No AI Model Training:</strong> We fully respect your intellectual property and sensitive commercial information. Your documents are processed exclusively for immediate data extraction and are explicitly restricted from being used to train, fine-tune, or otherwise improve our artificial intelligence models or any third-party foundation models.</li>
      </ul>

      <h2>4. Disclaimer</h2>
      <p>The materials on BrainHalf are provided on an 'as is' basis. BrainHalf makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property.</p>
      <p>Due to the nature of Artificial Intelligence (Hunyuan OCR), we cannot guarantee 100% accuracy of the extracted text. You are responsible for verifying the output before utilizing it in production environments.</p>

      <h2>5. Limitations</h2>
      <p>In no event shall BrainHalf or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on BrainHalf's website.</p>

      <h2>6. Governing Law</h2>
      <p>These terms and conditions are governed by and construed in accordance with international corporate laws, and you irrevocably submit to the exclusive jurisdiction of the courts in that State or location.</p>
    </LegalLayout>
  );
}
