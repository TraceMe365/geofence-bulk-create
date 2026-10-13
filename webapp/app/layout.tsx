import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wialon Geofence Bulk Importer",
  description: "Bulk-create circular geofences in Wialon from a CSV file.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
