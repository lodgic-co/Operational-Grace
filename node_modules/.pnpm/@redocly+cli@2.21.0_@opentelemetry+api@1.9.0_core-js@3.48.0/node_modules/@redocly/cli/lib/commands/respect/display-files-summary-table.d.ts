import { type LoggerInterface } from '@redocly/openapi-core';
import { type WorkflowExecutionResult } from '@redocly/respect-core';
export declare function displayFilesSummaryTable(filesResult: {
    file: string;
    hasProblems: boolean;
    executedWorkflows: WorkflowExecutionResult[];
    argv?: {
        workflow?: string[];
        skip?: string[];
    };
}[], logger: LoggerInterface): void;
//# sourceMappingURL=display-files-summary-table.d.ts.map