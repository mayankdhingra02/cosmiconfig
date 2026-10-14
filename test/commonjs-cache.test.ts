import { execFileSync } from 'child_process';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TempDir } from './util';

const temp = new TempDir();

beforeAll(() => {
  // Use Node's actual module caches, rather than Vitest's transformed modules.
  execFileSync(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--outDir',
    temp.absolutePath('dist'),
    '--tsBuildInfoFile',
    temp.absolutePath('tsconfig.tsbuildinfo'),
  ]);
}, 20000);

afterAll(() => {
  temp.deleteTempDir();
});

const script = `
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { cosmiconfig } = require(process.argv[1]);
const filepath = process.argv[2];
const method = process.argv[3];
const filename = path.basename(filepath);
const options = { searchPlaces: [filename] };
const load = (explorer) => explorer[method](method === 'load' ? filepath : path.dirname(filepath));
const write = (count) => {
  const assertion = filepath.endsWith('.cts') ? ' as const' : '';
  writeFileSync(filepath, 'module.exports = { count: ' + count + ' }' + assertion + ';');
};

const explorer = cosmiconfig('foo', options);
write(1);
const initial = await load(explorer);
write(2);
const cached = await load(explorer);
const fresh = await load(cosmiconfig('foo', options));
explorer.clearCaches();
const cleared = await load(explorer);
const uncachedExplorer = cosmiconfig('foo', { ...options, cache: false });
const uncachedInitial = await load(uncachedExplorer);
write(3);
const uncachedUpdated = await load(uncachedExplorer);

process.stdout.write(JSON.stringify([
  initial, cached, fresh, cleared, uncachedInitial, uncachedUpdated
].map((result) => result.config.count)));
`;

describe.each(['cjs', 'cts'])(
  'CommonJS .%s configuration caching',
  (extension) => {
    test.each(['load', 'search'])(
      'reloads changed files using %s without disabling explorer caches',
      (method) => {
        const directory = `${extension}-${method}`;
        temp.createFile(`${directory}/package.json`, '{ "type": "module" }');
        const output = execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            script,
            temp.absolutePath('dist/index.js'),
            temp.absolutePath(`${directory}/foo.config.${extension}`),
            method,
          ],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              NODE_PATH: [path.resolve('node_modules'), process.env.NODE_PATH]
                .filter(Boolean)
                .join(path.delimiter),
            },
          },
        );

        expect(JSON.parse(output)).toEqual([1, 1, 2, 2, 2, 3]);
      },
    );
  },
);
