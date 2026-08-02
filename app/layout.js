import "./globals.css";

export const metadata = {
  title: "Blueprint",
  description: "Find the team for what you're building.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
