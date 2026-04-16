export type ListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
