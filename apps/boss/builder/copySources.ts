import * as Fs from 'fs';
import * as Path from 'path';

const dest = Path.join(process.cwd(), process.argv[2]);

const baseBuild = `${__dirname}/../../../..`;

const copyOnTimeoutByDir: { [dir: string]: NodeJS.Timeout } = {};

function copyDir(baseDir: string, outDir: string): void {
  if (!Fs.existsSync(outDir)) Fs.mkdirSync(outDir);

  const packageJson = Fs.existsSync(`${baseDir}/package.json`)
    ? JSON.parse(Fs.readFileSync(`${baseDir}/package.json`, 'utf8'))
    : { private: false };

  for (const dir of Fs.readdirSync(baseDir)) {
    if (dir === 'node_modules' || dir === 'packages' || dir === 'boss' || dir.endsWith('-ui'))
      continue;
    const dirPath = `${baseDir}/${dir}`;
    const outPath = `${outDir}/${dir}`;

    if (Fs.statSync(dirPath).isDirectory()) {
      if (!Fs.existsSync(outPath)) {
        Fs.mkdirSync(outPath);
      }

      copyDir(dirPath, outPath);

      if (
        process.argv[3] === '--watch' &&
        (dirPath.endsWith('chromealive/ui') || dirPath.endsWith('chromealive/extension'))
      ) {
        // eslint-disable-next-line no-console
        console.log('Registering watch', dirPath);
        Fs.watch(dirPath, () => {
          clearTimeout(copyOnTimeoutByDir[dirPath]);
          copyOnTimeoutByDir[dirPath] = setTimeout(() => {
            // eslint-disable-next-line no-console
            console.log('Files changed in chromealive');
            copyDir(dirPath, outPath);
          }, 50);
        });
      }
    } else if (!packageJson.workspaces) {
      Fs.copyFileSync(dirPath, outPath);
    }
  }
}

copyDir(`${baseBuild}/build`, dest);
copyDir(`${baseBuild}/hero/build`, `${dest}/hero`);

// eslint-disable-next-line no-console
console.log('Copied files to dest', dest);
