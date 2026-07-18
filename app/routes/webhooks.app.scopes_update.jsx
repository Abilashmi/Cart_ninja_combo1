import { authenticate } from "../shopify.server";
import sessionDb from "../session-db.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    try {
      await sessionDb.session.update({
        where: {
          id: session.id,
        },
        data: {
          scope: current.toString(),
        },
      });
    } catch (error) {
      console.error("Error updating session scope", error);
    }
  }

  return new Response();
};