/**
 * Response envelope utilities — Part 7 general conventions.
 * Every endpoint uses this shape, staff and customer namespaces alike.
 */

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}

export interface SuccessResponse<T> {
  data: T;
  errors: never[];
}

export interface ErrorResponse {
  data: null;
  errors: ApiError[];
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
  };
}

/**
 * 200/201 success envelope
 */
export function success<T>(data: T, status: number = 200): Response {
  return new Response(
    JSON.stringify({ data, errors: [] }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Error envelope — maps to the spec's { data: null, errors: [{code, message, field?}] }
 */
export function error(
  code: string,
  message: string,
  status: number = 400,
  field?: string
): Response {
  const errors: ApiError[] = [{ code, message, ...(field && { field }) }];
  return new Response(
    JSON.stringify({ data: null, errors }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Paginated list response
 */
export function paginated<T>(
  data: T[],
  page: number,
  per_page: number,
  total: number
): Response {
  return new Response(
    JSON.stringify({
      data,
      pagination: { page, per_page, total },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
