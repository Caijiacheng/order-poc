export type ListQuery = {
  page: number;
  pageSize: number;
  q: string;
  status: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
};

export function parseListQuery(searchParams: URLSearchParams): ListQuery {
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? "10");
  const sortOrderRaw = searchParams.get("sortOrder");

  return {
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1,
    pageSize:
      Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(Math.floor(pageSizeRaw), 100)
        : 10,
    q: (searchParams.get("q") ?? "").trim(),
    status: (searchParams.get("status") ?? "").trim(),
    sortBy: (searchParams.get("sortBy") ?? "").trim(),
    sortOrder: sortOrderRaw === "asc" ? "asc" : "desc",
  };
}

type FilterContext<TItem> = {
  query: ListQuery;
  searchFields: Array<keyof TItem>;
  statusField?: keyof TItem;
  statusResolver?: (item: TItem) => string;
  defaultSortBy: keyof TItem;
};

export function filterSortAndPaginate<TItem extends Record<string, unknown>>(
  items: TItem[],
  context: FilterContext<TItem>,
) {
  const { query, searchFields, statusField, statusResolver, defaultSortBy } = context;

  let filtered = [...items];

  if (query.q) {
    const q = query.q.toLowerCase();
    filtered = filtered.filter((item) =>
      searchFields.some((field) => {
        const value = item[field];
        if (value === null || value === undefined) {
          return false;
        }
        if (Array.isArray(value)) {
          return value.join(" ").toLowerCase().includes(q);
        }
        return String(value).toLowerCase().includes(q);
      }),
    );
  }

  if (query.status) {
    const expected = query.status.toLowerCase();
    filtered = filtered.filter((item) => {
      if (statusResolver) {
        return statusResolver(item).toLowerCase() === expected;
      }
      if (!statusField) {
        return true;
      }
      const value = item[statusField];
      return String(value ?? "").toLowerCase() === expected;
    });
  }

  const sortByKey = (query.sortBy || String(defaultSortBy)) as keyof TItem;
  filtered.sort((a, b) => {
    const left = a[sortByKey];
    const right = b[sortByKey];

    if (left === right) {
      return 0;
    }

    if (typeof left === "number" && typeof right === "number") {
      return query.sortOrder === "asc" ? left - right : right - left;
    }

    const leftValue = String(left ?? "").toLowerCase();
    const rightValue = String(right ?? "").toLowerCase();
    const compare = leftValue.localeCompare(rightValue, "zh-CN");
    return query.sortOrder === "asc" ? compare : -compare;
  });

  const total = filtered.length;
  const start = (query.page - 1) * query.pageSize;
  const paged = filtered.slice(start, start + query.pageSize);

  return {
    items: paged,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
