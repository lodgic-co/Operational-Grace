import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
export function readEnvVariables(executionFilePath) {
    if (executionFilePath) {
        let currentDir = path.dirname(executionFilePath);
        while (currentDir !== path.resolve(currentDir, '..')) {
            const envFilePath = path.join(currentDir, '.env');
            if (fs.existsSync(envFilePath)) {
                dotenv.config({ path: envFilePath });
                break;
            }
            currentDir = path.resolve(currentDir, '..');
        }
    }
    return process.env;
}
//# sourceMappingURL=read-env-variables.js.map