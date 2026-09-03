export { type MemoryKind, type MemoryRecord } from '../../shared/src/index.js';

// Retrieval is deliberately simple for milestone 1: newest agent-owned memories
// are selected by the persistence repository. Semantic/vector search can be added
// behind this package boundary without changing the world engine.
