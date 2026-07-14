import { test, expect } from "../../fixtures/phpApi";

const SHOP = "playwright-test-ai-conversations.myshopify.com";

test.describe("ai_conversations.php + ai_messages.php", () => {
  test("GET with no shop param returns an empty conversations list, not an error", async ({ phpApi }) => {
    const res = await phpApi.get("ai_conversations.php", {
      params: { shop: "playwright-test-never-seen.myshopify.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.conversations).toEqual([]);
  });

  test("POST creates a conversation, GET lists it back", async ({ phpApi }) => {
    const postRes = await phpApi.post("ai_conversations.php", {
      data: { shop: SHOP, title: "Playwright test chat" },
    });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.status).toBe("success");
    expect(postBody.conversation.title).toBe("Playwright test chat");
    const conversationId = postBody.conversation.id;
    expect(conversationId).toBeTruthy();

    const getRes = await phpApi.get("ai_conversations.php", { params: { shop: SHOP } });
    const getBody = await getRes.json();
    expect(getBody.conversations.some((c: { id: string }) => c.id === conversationId)).toBe(true);
  });

  test("messages: POST saves a message under a conversation, GET lists it in order", async ({ phpApi }) => {
    const convRes = await phpApi.post("ai_conversations.php", {
      data: { shop: SHOP, title: "Message thread" },
    });
    const conversationId = (await convRes.json()).conversation.id;

    await phpApi.post("ai_messages.php", {
      data: { conversationId, role: "user", message: "Enable the cart drawer" },
    });
    const assistantRes = await phpApi.post("ai_messages.php", {
      data: { conversationId, role: "assistant", message: "Done — cart drawer is enabled." },
    });
    expect(assistantRes.status()).toBe(200);

    const getRes = await phpApi.get("ai_messages.php", { params: { conversationId } });
    const body = await getRes.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[1].role).toBe("assistant");
  });

  test("messages: GET with no conversationId returns an empty list, not an error", async ({ phpApi }) => {
    const res = await phpApi.get("ai_messages.php");
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.messages).toEqual([]);
  });

  test("messages: POST with a missing field returns 400", async ({ phpApi }) => {
    const res = await phpApi.post("ai_messages.php", {
      data: { conversationId: "whatever", role: "user" }, // missing `message`
    });
    expect(res.status()).toBe(400);
  });
});
