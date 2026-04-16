import { beforeEach, describe, expect, it } from "vitest";

import {
  AdminServiceError,
  createDealer,
  createProduct,
  getProductById,
  listProducts,
  softDeleteProduct,
  softDeleteSuggestionTemplate,
} from "../../lib/admin/service";
import type { ListQuery } from "../../lib/admin/list-query";
import { resetRuntimeState } from "../helpers/runtime";

const LIST_QUERY: ListQuery = {
  page: 1,
  pageSize: 200,
  q: "",
  status: "",
  sortBy: "display_order",
  sortOrder: "asc",
};

describe("admin service CRUD guardrails", () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  it("soft-deletes product by setting status inactive and prevents duplicate delete", () => {
    const targetId = "cb_weijixian_500";
    expect(getProductById(targetId)?.status).toBe("active");

    const deleted = softDeleteProduct(targetId);
    expect(deleted.status).toBe("inactive");

    const activeList = listProducts({ ...LIST_QUERY, status: "active" }).items;
    expect(activeList.some((item) => item.sku_id === targetId)).toBe(false);

    expect(() => softDeleteProduct(targetId)).toThrowError(AdminServiceError);
    try {
      softDeleteProduct(targetId);
    } catch (error) {
      expect(error).toBeInstanceOf(AdminServiceError);
      const typed = error as AdminServiceError;
      expect(typed.code).toBe("CONFLICT");
    }
  });

  it("validates product pair_items must reference existing SKU", () => {
    expect(() =>
      createProduct({
        sku_id: "stage5_invalid_pair",
        sku_name: "stage5 invalid pair",
        brand: "厨邦",
        category: "测试",
        spec: "500ml",
        price_per_case: 100,
        box_multiple: 6,
        tags: ["stage5"],
        pair_items: ["not_exist_sku"],
        is_weekly_focus: false,
        is_new_product: false,
        status: "active",
        display_order: 999,
      }),
    ).toThrowError(AdminServiceError);

    try {
      createProduct({
        sku_id: "stage5_invalid_pair",
        sku_name: "stage5 invalid pair",
        brand: "厨邦",
        category: "测试",
        spec: "500ml",
        price_per_case: 100,
        box_multiple: 6,
        tags: ["stage5"],
        pair_items: ["not_exist_sku"],
        is_weekly_focus: false,
        is_new_product: false,
        status: "active",
        display_order: 999,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AdminServiceError);
      const typed = error as AdminServiceError;
      expect(typed.code).toBe("VALIDATION_ERROR");
      expect(typed.fieldErrors?.pair_items).toContain("not_exist_sku");
    }
  });

  it("validates dealer frequent/forbidden items must exist in product master", () => {
    expect(() =>
      createDealer({
        customer_id: "dealer_stage5_invalid",
        customer_name: "stage5 invalid dealer",
        city: "厦门",
        customer_type: "测试",
        channel_type: "测试",
        store_count_hint: "1",
        last_order_days_ago: 1,
        order_frequency: "7天",
        price_sensitivity: "中",
        new_product_acceptance: "中",
        frequent_items: ["not_exist_sku"],
        forbidden_items: [],
        preferred_categories: ["生抽"],
        business_traits: ["测试"],
        status: "active",
      }),
    ).toThrowError(AdminServiceError);
  });

  it("soft-deletes suggestion template by toggling enabled=false", () => {
    const deleted = softDeleteSuggestionTemplate("tpl_xm_daily");
    expect(deleted.enabled).toBe(false);

    expect(() => softDeleteSuggestionTemplate("tpl_xm_daily")).toThrowError(
      AdminServiceError,
    );
    try {
      softDeleteSuggestionTemplate("tpl_xm_daily");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminServiceError);
      const typed = error as AdminServiceError;
      expect(typed.code).toBe("CONFLICT");
    }
  });
});
