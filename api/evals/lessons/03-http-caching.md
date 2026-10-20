---
title: HTTP caching
count: 5
difficulty: hard
---

HTTP caching lets a browser reuse a response it has already downloaded instead of requesting it again. Caching makes pages load faster and reduces the load on servers.

A server controls caching with the Cache-Control header. The max-age directive tells the browser how many seconds a response stays fresh. While a response is fresh, the browser uses its cached copy without contacting the server.

The no-store directive tells the browser not to keep a copy at all, which suits sensitive data such as bank statements.

When a cached response becomes stale, the browser can revalidate it. It sends the response's ETag in an If-None-Match header. If the content has not changed, the server replies with 304 Not Modified and an empty body, and the browser keeps using its copy.
