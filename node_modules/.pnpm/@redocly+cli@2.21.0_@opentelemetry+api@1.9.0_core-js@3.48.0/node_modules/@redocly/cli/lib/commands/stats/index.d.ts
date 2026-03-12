import type { OutputFormat } from '@redocly/openapi-core';
import type { VerifyConfigOptions } from '../../types.js';
import type { CommandArgs } from '../../wrapper.js';
export type StatsArgv = {
    api?: string;
    format: OutputFormat;
} & VerifyConfigOptions;
export declare function handleStats({ argv, config, collectSpecData }: CommandArgs<StatsArgv>): Promise<void>;
//# sourceMappingURL=index.d.ts.map