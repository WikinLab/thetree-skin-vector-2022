import fs from 'node:fs';
import path from 'node:path';
import { compareCodePoints } from './shared/deterministic.mjs';

function readMessages(pathname) {
  const parsed = JSON.parse(fs.readFileSync(pathname, 'utf8'));
  delete parsed['@metadata'];
  return parsed;
}

function stableObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCodePoints(left, right)));
}

function writeGenerated(root, pathname, content, check) {
  const target = path.join(root, pathname);
  const normalized = `${String(content).replace(/\r\n?/g, '\n').replace(/\s*$/, '')}\n`;
  if (check) {
    if (!fs.existsSync(target)) throw new Error(`Missing generated message catalog: ${pathname}`);
    const current = fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
    if (current !== normalized) throw new Error(`Generated message catalog is stale: ${pathname}`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, normalized);
}

export function generateMessageOrigin({ root, contractPath, vendorEntries = [], check = false }) {
  const contract = JSON.parse(fs.readFileSync(path.join(root, contractPath), 'utf8'));
  if (contract.schema !== 1 || !contract.output || !contract.languages) {
    throw new Error(`Invalid message origin contract: ${contractPath}`);
  }
  const declaredVendor = new Set(vendorEntries.map((entry) => typeof entry === 'string' ? entry : entry?.path).filter(Boolean));
  const inputs = [];
  const languages = {};
  for (const language of Object.keys(contract.languages).sort(compareCodePoints)) {
    const definition = contract.languages[language];
    if (!Array.isArray(definition.sources) || !definition.sources.length) {
      throw new Error(`Message language ${language} has no declared source files.`);
    }
    const messages = {};
    for (const source of definition.sources) {
      if (!declaredVendor.has(source)) throw new Error(`Message source is not declared in vendorFiles: ${source}`);
      const absolute = path.join(root, source);
      if (!fs.existsSync(absolute)) throw new Error(`Message source is not materialized: ${source}`);
      Object.assign(messages, readMessages(absolute));
      inputs.push(source);
    }
    languages[language] = {
      fallback: typeof definition.fallback === 'string' ? definition.fallback : null,
      messages: stableObject(messages)
    };
  }
  const content = `/* Generated from the locked MediaWiki and Vector message catalogs. */\nconst catalog = ${JSON.stringify({ languages }, null, 2)};\n\nexport default Object.freeze(catalog);`;
  writeGenerated(root, contract.output, content, check);
  return {
    inputs: [...new Set(inputs)].sort(compareCodePoints),
    outputs: [contract.output],
    relations: [{
      path: contract.output,
      input: inputs[0],
      dependencies: [...new Set(inputs.slice(1))].sort(compareCodePoints)
    }]
  };
}
