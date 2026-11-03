import { enqueueScheduledStories, processStoryQueue } from './stories.js';

export function startScheduler(intervalMs = 15000) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const enqueued = await enqueueScheduledStories();
      const processed = await processStoryQueue();
      if (enqueued || processed) {
        console.log(`Story scheduler: ${enqueued} scheduled, ${processed} processed.`);
      }
    } catch (error) {
      console.error('Story scheduler failed:', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
