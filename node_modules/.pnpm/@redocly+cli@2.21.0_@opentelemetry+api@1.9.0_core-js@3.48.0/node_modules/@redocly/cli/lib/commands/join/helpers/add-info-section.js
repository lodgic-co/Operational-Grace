import { exitWithError } from '../../../utils/error.js';
import { COMPONENTS } from '../../split/types.js';
import { addComponentsPrefix } from './add-components-prefix.js';
import { getInfoPrefix } from './get-info-prefix.js';
export function addInfoSectionAndSpecVersion(joinedDef, documents, prefixComponentsWithInfoProp) {
    const firstApi = documents[0];
    const openapi = firstApi.parsed;
    const componentsPrefix = getInfoPrefix(openapi.info, prefixComponentsWithInfoProp, COMPONENTS);
    if (!openapi.openapi)
        exitWithError('Version of specification is not found.');
    if (!openapi.info)
        exitWithError('Info section is not found in specification.');
    if (openapi.info?.description) {
        openapi.info.description = addComponentsPrefix(openapi.info.description, componentsPrefix);
    }
    joinedDef.openapi = openapi.openapi;
    joinedDef.info = openapi.info;
}
//# sourceMappingURL=add-info-section.js.map