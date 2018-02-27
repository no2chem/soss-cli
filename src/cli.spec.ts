import 'mocha';

import * as chai from 'chai';
import * as path from 'path';

import * as cli from './cli';

const tester = require('cli-tester');
const fs = require('fs-extra');
chai.should();

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Needed for should.not.be.undefined.
/* tslint:disable:no-unused-expression */

const cliPath = path.join(__dirname, '../build/src/cli.js');
const cliDataPath = path.join(__dirname, `../build/src/${cli.DATA_FILE}`);

describe('CLI tests', () => {
  it('should exit with code 0 without input', async () => {
    const result: CliResult = await tester(cliPath);
    result.code.should.eq(0);
  });

  it('should generate a data file', async () => {
    await tester(cliPath, 'clear-data');
    const result: CliResult = await tester(cliPath, 'get-data');
    console.log(cliDataPath);
    fs.existsSync(cliDataPath).should.be.true;
  });

  after(async () => {
    try {
      await fs.unlink(cli.DATA_FILE_PATH);
    } catch {
      // File did not exist (ok).
    }
  });
});