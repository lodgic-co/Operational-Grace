import { logger } from '@redocly/openapi-core';
import { blue } from 'colorette';
import * as path from 'node:path';
export function collectExternalDocs({ joinedDef, openapi, context, }) {
    const { api } = context;
    const { externalDocs } = openapi;
    if (externalDocs) {
        if (joinedDef.hasOwnProperty('externalDocs')) {
            logger.warn(`warning: skip externalDocs from ${blue(path.basename(api))} \n`);
            return;
        }
        joinedDef['externalDocs'] = externalDocs;
    }
}
//# sourceMappingURL=collect-external-docs.js.map