/**
 * Named API types, taken from the types generated from the OpenAPI spec
 * (`npm run api:types`, which reads ../postman/openapi.json). Never edit
 * openapi.generated.ts by hand: change the API, export its spec, regenerate.
 */
import type { components } from './openapi.generated';

type Schemas = components['schemas'];

export type CreateLessonRequest = Schemas['CreateLessonDto'];
export type LessonResponse = Schemas['LessonResponse'];

export type GenerateQuizRequest = Schemas['GenerateQuizDto'];
export type QuizResponse = Schemas['QuizResponse'];
export type QuizSummaryResponse = Schemas['QuizSummaryResponse'];
export type QuizStreamStartedResponse = Schemas['QuizStreamStartedResponse'];
export type QuizSettings = Schemas['QuizSettingsResponse'];
export type ReviewStatsResponse = Schemas['ReviewStatsResponse'];

export type QuestionResponse = Schemas['QuestionResponse'];
export type UpdateQuestionRequest = Schemas['UpdateQuestionDto'];

export type ProblemFieldError = Schemas['ProblemFieldErrorDto'];

export type UsageReport = Schemas['UsageReportResponse'];
export type UsageBucket = Schemas['UsageBucketResponse'];
export type UsageDay = Schemas['UsageDayResponse'];

export type QuestionType = QuestionResponse['type'];
export type QuestionStatus = QuestionResponse['status'];
export type QuizStatus = QuizResponse['status'];
export type Difficulty = GenerateQuizRequest['difficulty'];
export type QuizFailureReason = NonNullable<QuizResponse['failureReason']>;
