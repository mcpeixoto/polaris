// Vitest environment setup.
//
// fake-indexeddb is loaded globally rather than per-test file because the store module
// touches indexedDB at import time; a per-file import would race the module graph.
import 'fake-indexeddb/auto';
