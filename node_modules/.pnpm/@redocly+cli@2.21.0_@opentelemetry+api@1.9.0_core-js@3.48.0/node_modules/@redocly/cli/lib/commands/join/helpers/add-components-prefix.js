import * as path from 'node:path';
import { addPrefix } from './add-prefix.js';
export function addComponentsPrefix(description, componentsPrefix) {
    return description.replace(/"(#\/components\/.*?)"/g, (match) => {
        const componentName = path.basename(match);
        return match.replace(componentName, addPrefix(componentName, componentsPrefix));
    });
}
//# sourceMappingURL=add-components-prefix.js.map