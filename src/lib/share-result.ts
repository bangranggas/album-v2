/** The outcome a share attempt reports on `/share-target/result`. */
export type ShareResultStatus =
  | "ok"
  | "error"
  | "invalid"
  | "offline"
  | "unauthorized"
  | "noop";

interface ShareResultCopy {
  title: string;
  body: string;
  /** `true` for the one success case; the page colours itself from this. */
  success: boolean;
}

/**
 * Fills in the result page's message for a raw `?status=` value.
 *
 * Unknown or missing values fall back to `noop` rather than an error: a bare visit
 * to the result page is not a failed share, it just has nothing to report.
 */
export function describeShareResult(
  raw: string | string[] | undefined,
): { status: ShareResultStatus; copy: ShareResultCopy } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const status = isShareResultStatus(value) ? value : "noop";

  switch (status) {
    case "ok":
      return {
        status,
        copy: {
          title: "Link saved",
          body: "The shared link is now in your collection.",
          success: true,
        },
      };
    case "error":
      return {
        status,
        copy: {
          title: "Could not save the link",
          body: "Something went wrong while saving. Open the dashboard and add it by hand.",
          success: false,
        },
      };
    case "invalid":
      return {
        status,
        copy: {
          title: "No link in that share",
          body: "Nothing that looked like a web address was shared. Try again from the page itself.",
          success: false,
        },
      };
    case "offline":
      return {
        status,
        copy: {
          title: "Could not reach the server",
          body: "Check your connection, then share the link again.",
          success: false,
        },
      };
    case "unauthorized":
      return {
        status,
        copy: {
          title: "Sign in to save links",
          body: "You were signed out. Sign in again, then share the link once more.",
          success: false,
        },
      };
    case "noop":
      return {
        status,
        copy: {
          title: "Nothing to report",
          body: "Share a link to this app from your browser to save it here.",
          success: false,
        },
      };
  }
}

function isShareResultStatus(value: unknown): value is ShareResultStatus {
  return (
    value === "ok" ||
    value === "error" ||
    value === "invalid" ||
    value === "offline" ||
    value === "unauthorized" ||
    value === "noop"
  );
}
