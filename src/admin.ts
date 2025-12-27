import { jsxRenderer } from "hono/jsx-renderer";
import { Effect } from "effect";
import type { Context } from "hono";
import type { OptKitConfig } from "./types";
import { optkit } from "./index";

export function adminUI(config: OptKitConfig) {
  const kit = optkit(config);
  const renderer = jsxRenderer(({ children }) => (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>OptKit Admin</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50">{children}</body>
    </html>
  ));

  return async (c: Context) => {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "50");
    const status = c.req.query("status") || "";
    const search = c.req.query("search") || "";
    const sort = (c.req.query("sort") as "created" | "updated" | "email") || "created";
    const order = (c.req.query("order") as "asc" | "desc") || "desc";

    const result = await Effect.runPromise(
      kit.list({ page, limit, status: status as any, search, sort, order })
    );

    const buildQuery = (updates: Record<string, string | number>) => {
      const params = new URLSearchParams();
      if (page !== 1) params.set("page", String(page));
      if (limit !== 50) params.set("limit", String(limit));
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      if (sort !== "created") params.set("sort", sort);
      if (order !== "desc") params.set("order", order);
      
      Object.entries(updates).forEach(([k, v]) => {
        if (v) params.set(k, String(v));
        else params.delete(k);
      });
      
      const qs = params.toString();
      return qs ? `?${qs}` : "";
    };

    return renderer(c, () => (
      <div class="min-h-screen p-8">
        <div class="max-w-7xl mx-auto">
          <div class="mb-8">
            <h1 class="text-4xl font-bold text-gray-900 mb-2">OptKit Admin</h1>
            <div class="flex gap-4 text-lg">
              <div class="bg-green-100 px-4 py-2 rounded">
                <span class="font-semibold">{result.active}</span> active
              </div>
              <div class="bg-gray-100 px-4 py-2 rounded">
                <span class="font-semibold">{result.total}</span> total
              </div>
              <div class="bg-red-100 px-4 py-2 rounded">
                <span class="font-semibold">{result.unsubscribed}</span> unsubscribed
              </div>
            </div>
          </div>

          {/* Filters */}
          <div class="bg-white rounded-lg shadow p-4 mb-4">
            <form method="get" class="flex gap-4 items-end">
              <div class="flex-1">
                <label class="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <input
                  type="text"
                  name="search"
                  value={search}
                  placeholder="Search email..."
                  class="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select name="status" class="px-3 py-2 border border-gray-300 rounded-md">
                  <option value="">All</option>
                  <option value="active" selected={status === "active"}>Active</option>
                  <option value="unsubscribed" selected={status === "unsubscribed"}>Unsubscribed</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Sort</label>
                <select name="sort" class="px-3 py-2 border border-gray-300 rounded-md">
                  <option value="created" selected={sort === "created"}>Created</option>
                  <option value="updated" selected={sort === "updated"}>Updated</option>
                  <option value="email" selected={sort === "email"}>Email</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Order</label>
                <select name="order" class="px-3 py-2 border border-gray-300 rounded-md">
                  <option value="desc" selected={order === "desc"}>Desc</option>
                  <option value="asc" selected={order === "asc"}>Asc</option>
                </select>
              </div>
              <button
                type="submit"
                class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Filter
              </button>
            </form>
          </div>

          {/* Table */}
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                {result.subscribers.map((sub) => (
                  <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sub.email}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        sub.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}>
                        {sub.status}
                      </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(sub.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {result.hasMore && (
            <div class="mt-4 flex justify-center">
              <a
                href={buildQuery({ page: page + 1 })}
                class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Load More
              </a>
            </div>
          )}
        </div>
      </div>
    ));
  };
}
