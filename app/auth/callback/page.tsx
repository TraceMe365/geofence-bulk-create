"use client";

import { useEffect, useState } from "react";

export default function AuthCallback() {
  const [status, setStatus] = useState("Completing sign-in...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get("access_token");
    const userName = params.get("user_name");
    const svcError = params.get("svc_error");

    if (window.opener) {
      window.opener.postMessage(
        {
          source: "wialon-auth",
          accessToken: accessToken || null,
          userName: userName || null,
          error: accessToken ? null : svcError || "Login was cancelled or failed.",
        },
        window.location.origin
      );
      setStatus(accessToken ? "Signed in. You can close this window." : "Sign-in failed. You can close this window.");
      window.close();
    } else {
      setStatus(
        accessToken
          ? "Signed in. You can close this window and return to the app."
          : "Sign-in failed. You can close this window and return to the app."
      );
    }
  }, []);

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      <p>{status}</p>
    </div>
  );
}
