import { Link } from "wouter";

import { LegalLayout } from "./LegalLayout";

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" canonicalPath="/privacy">
      <h2>1. Information We Collect</h2>
      <p>We only collect the information necessary to provide you with the BrainHalf OCR service. This includes:</p>
      <ul>
        <li><strong>Account Information:</strong> Your email address and basic profile details when you sign up using Google Auth.</li>
        <li><strong>Document Data:</strong> The invoices, receipts, and documents you upload for extraction. These are processed temporarily to extract the necessary data.</li>
        <li><strong>Usage Analytics:</strong> Anonymous usage metrics through tools like Google Analytics to improve the platform experience.</li>
      </ul>

      <h2>2. Core Data Privacy Commitments</h2>
      <p>At BrainHalf, the security and confidentiality of your information are fundamental to our operations. We strictly adhere to the following core commitments regarding the handling of your data:</p>
      <ul>
        <li><strong>No Data Misuse:</strong> We process your documents and information strictly for the purpose of providing the data extraction services you have requested. We do not engage in unauthorized access, secondary processing, or any form of misuse of your confidential data.</li>
        <li><strong>No Data Selling or Unauthorized Sharing:</strong> Your personal information and uploaded documents are strictly confidential. We do not sell, rent, license, or distribute your data to third-party data brokers or marketing agencies under any circumstances without your explicit, opt-in consent.</li>
        <li><strong>No AI Model Training:</strong> We fully respect your intellectual property and sensitive commercial information. Your documents are processed exclusively for immediate data extraction and are explicitly restricted from being used to train, fine-tune, or otherwise improve our artificial intelligence models or any third-party foundation models.</li>
      </ul>

      <h2>3. How We Use Your Data</h2>
      <p>Your uploaded documents are transmitted securely to our extraction engine (BH Model 1) and are <strong>not used to train our AI models</strong>. Once the extraction is complete, your extracted data is safely stored locally in your browser's IndexedDB database.</p>
      <p>We do not sell, rent, or trade your personal information or uploaded documents with third parties.</p>

      <h2>3. Data Security & Retention</h2>
      <p>All data transmitted between your browser and our secure backend proxy is encrypted using TLS. Your extracted structured data remains solely on your local device unless you explicitly clear your browser storage or export the data.</p>

      <h2>4. Your Rights</h2>
      <p>You have the full right to delete your data at any time. Simply use the bulk delete feature within the app to permanently erase your batches from your browser, or contact us to delete your authentication account.</p>

      <h2>5. Contact Us</h2>
      <p>If you have any questions or concerns regarding this Privacy Policy, please reach out via our <Link href="/contact">Contact Page</Link>.</p>
    </LegalLayout>
  );
}
