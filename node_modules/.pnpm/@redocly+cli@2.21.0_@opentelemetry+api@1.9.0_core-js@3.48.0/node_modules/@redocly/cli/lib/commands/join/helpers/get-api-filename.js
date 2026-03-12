import * as path from 'node:path';
export function getApiFilename(filePath) {
    return path.basename(filePath, path.extname(filePath));
}
//# sourceMappingURL=get-api-filename.js.map