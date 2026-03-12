import type { VerifyConfigOptions } from '../types.js';
import type { CommandArgs } from '../wrapper.js';
export type EjectArgv = {
    type: 'component';
    path?: string;
    'project-dir'?: string;
    force: boolean;
} & VerifyConfigOptions;
export declare const handleEject: ({ argv }: CommandArgs<EjectArgv>) => Promise<void>;
//# sourceMappingURL=eject.d.ts.map