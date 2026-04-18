import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";
import { refineBundleTemplateForCustomer } from "@/lib/domain/business-service";

export async function POST(request: Request) {
  try {
    assertLlmAvailable();
    const payload = (await request.json()) as {
      customerId?: string;
      templateType?: "hot_sale_restock" | "stockout_restock" | "campaign_stockup";
      currentItems?: Array<{
        sku_id?: string;
        sku_name?: string;
        suggested_qty?: number;
        reason?: string;
        reason_tags?: string[];
        priority?: number;
        unit_price?: number;
        line_amount?: number;
      }>;
      userNeed?: string;
    };

    if (!payload.customerId) {
      return apiError("VALIDATION_ERROR", "customerId 不能为空", 400, {
        customerId: "customerId 不能为空",
      });
    }
    if (!payload.templateType) {
      return apiError("VALIDATION_ERROR", "templateType 不能为空", 400, {
        templateType: "templateType 不能为空",
      });
    }
    if (!payload.currentItems || payload.currentItems.length === 0) {
      return apiError("VALIDATION_ERROR", "当前建议商品不能为空", 400, {
        currentItems: "当前建议商品不能为空",
      });
    }

    const data = await refineBundleTemplateForCustomer({
      customer_id: payload.customerId,
      template_type: payload.templateType,
      current_items: payload.currentItems.map((item, index) => ({
        recommendation_item_id: undefined,
        sku_id: item.sku_id ?? "",
        sku_name: item.sku_name ?? "",
        suggested_qty: Math.max(1, Number(item.suggested_qty ?? 1)),
        reason: item.reason ?? "",
        reason_tags: Array.isArray(item.reason_tags) ? item.reason_tags : [],
        priority: Math.max(1, Number(item.priority ?? index + 1)),
        action_type: "add_to_cart",
        unit_price: Math.max(0, Number(item.unit_price ?? 0)),
        line_amount: Math.max(
          0,
          Number(item.line_amount ?? 0) ||
            Math.max(1, Number(item.suggested_qty ?? 1)) *
              Math.max(0, Number(item.unit_price ?? 0)),
        ),
      })),
      user_need: payload.userNeed ?? "",
    });

    return apiSuccess(data, {
      langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
    });
  } catch (error) {
    return handleBusinessRouteError(error);
  }
}
