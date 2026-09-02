const fs = require('fs');
const files = [
  'src/components/DocumentSidePanel.tsx',
  'src/pages/ReviewQueueDetail.tsx',
  'src/pages/DocumentDetails.tsx',
  'src/pages/BatchDetails.tsx'
];
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/"@\/lib\/humanizeField"/g, '"@/lib/humanize-field"');
  fs.writeFileSync(f, content);
});
