import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import globalStyles from "./global.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: globalStyles },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: `
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "xvh61tosao");
            `,
          }}
        />
        {/*
          Zingbot (ktt10) help & support widget. Loaded via a self-injecting
          loader rather than two bare <script> tags because:
            1. ktt10.setup() calls document.body.appendChild — running it from a
               plain inline <script> in <head> throws (body isn't parsed yet),
               so the widget silently never mounts. We defer setup to
               DOMContentLoaded.
            2. It also guarantees plugin.js has finished loading before setup()
               runs, instead of relying on script tag ordering surviving
               React's SSR/hydration.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
    (function () {
        function ktt10Init() {
            if (typeof ktt10 === "undefined" || !ktt10.setup) return;
            ktt10.setup({ id: "XrCozq0rELnonn", accountId: "1164913", color: "#1a9de0" });
        }
        var s = document.createElement("script");
        s.src = "https://app.zingbot.io/webchat/plugin.js?v=6";
        s.async = true;
        s.onload = function () {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", ktt10Init);
            } else {
                ktt10Init();
            }
        };
        (document.head || document.documentElement).appendChild(s);
    })();
            `,
          }}
        />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
