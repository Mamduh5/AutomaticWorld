export type LocalCognitionPhase = 'context_prepare' | 'request_prepare' | 'opportunity_prepare' | 'cognition_recovery' | 'cognition_commit';
export type LocalCognitionCode = 'input_budget_exceeded' | 'invalid_prepared_context' | 'configuration_invalid' | 'local_preparation_failed';

/** A kernel boundary failed; the message deliberately contains no original payload or secrets. */
export class LocalCognitionPreparationError extends Error {
  constructor(readonly phase: LocalCognitionPhase, readonly code: LocalCognitionCode) {
    super(`Local cognition preparation failure: ${phase}/${code}`);
    this.name = 'LocalCognitionPreparationError';
  }
}
