import { NextRequest, NextResponse } from "next/server";
export function proxy(request: NextRequest) {
  const selected = request.nextUrl.searchParams.get("lang");
  const headers = new Headers(request.headers);
  // Overwrite client-supplied hints. Final negotiation also checks enabled languages.
  headers.set(
    "x-kc-language",
    selected === "de" || selected === "en" ? selected : "",
  );
  const response = NextResponse.next({ request: { headers } });
  if (selected === "de" || selected === "en")
    response.cookies.set("kc_locale", selected, {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  return response;
}
export const config = { matcher: ["/((?!api|_next|icon.svg|favicon.ico).*)"] };
