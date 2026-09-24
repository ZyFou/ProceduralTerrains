import { bakeDetailPage } from './DetailPageBake.js';

self.onmessage = ({ data }) => {
  const { id, options } = data;
  try {
    const bytes = bakeDetailPage(options);
    self.postMessage({ id, bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
