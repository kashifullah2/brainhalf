const fs = require('fs');

const lines = fs.readFileSync('src/lib/api-client.ts', 'utf8').split('\n');
const sections = [];
let currentSection = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('// ---')) {
    const nextLine = lines[i + 1];
    if (nextLine && nextLine.startsWith('// ')) {
      const header = nextLine.replace('// ', '').trim();
      const nextNextLine = lines[i + 2];
      if (nextNextLine && nextNextLine.startsWith('// ---')) {
        currentSection = header;
        sections.push({ header, start: i });
        i += 2;
        continue;
      }
    }
  }
}

console.log(sections);
