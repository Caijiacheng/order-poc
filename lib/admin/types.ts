export type ListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type RecommendationRecordFilters = {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  scene?: string;
  surface?: string;
  generationMode?: string;
  skuId?: string;
  adoptionStatus?: string;
  modelName?: string;
  batchId?: string;
  strategyId?: string;
  expressionTemplateId?: string;
};

export type RecommendationBatchFilters = {
  dateFrom?: string;
  dateTo?: string;
  jobId?: string;
  customerId?: string;
  scene?: string;
  status?: string;
  publicationStatus?: string;
  triggerSource?: string;
  batchType?: string;
};
