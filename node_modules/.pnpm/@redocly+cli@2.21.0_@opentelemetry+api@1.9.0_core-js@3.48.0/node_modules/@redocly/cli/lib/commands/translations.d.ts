import type { VerifyConfigOptions } from '../types.js';
import type { CommandArgs } from '../wrapper.js';
export type TranslationsArgv = {
    locale: string;
    'project-dir'?: string;
} & VerifyConfigOptions;
export declare const handleTranslations: ({ argv }: CommandArgs<TranslationsArgv>) => Promise<void>;
//# sourceMappingURL=translations.d.ts.map