export class SharedResourceRegistry {
  constructor() { this.entries = new Map(); }

  retain(resource, dispose = (value) => value?.dispose?.()) {
    if (!resource) return null;
    const entry = this.entries.get(resource) || { refs: 0, dispose };
    entry.refs += 1;
    this.entries.set(resource, entry);
    return resource;
  }

  release(resource) {
    const entry = this.entries.get(resource);
    if (!entry) return false;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      this.entries.delete(resource);
      entry.dispose?.(resource);
    }
    return true;
  }

  refCount(resource) { return this.entries.get(resource)?.refs || 0; }
}

export class PreparedModeBundle {
  constructor({ key, worldMode, projectMode, registry = new SharedResourceRegistry() } = {}) {
    if (!key) throw new Error('PreparedModeBundle requires a render key');
    this.key = key;
    this.worldMode = worldMode;
    this.projectMode = projectMode;
    this.registry = registry;
    this.resources = new Map();
    this.state = 'preparing';
    this.validation = null;
  }

  own(name, resource, { shared = false, dispose } = {}) {
    if (this.state !== 'preparing') throw new Error('Cannot add resources after validation');
    if (!resource) return resource;
    if (shared) this.registry.retain(resource, dispose);
    this.resources.set(name, { resource, shared, dispose });
    return resource;
  }

  validate(result = {}) {
    if (this.state !== 'preparing') throw new Error(`Cannot validate a ${this.state} bundle`);
    if (result.ok === false || result.ready === false || result.error) {
      const error = result.error || new Error('Prepared mode bundle validation failed');
      error.code ||= 'MODE_BUNDLE_VALIDATION_FAILED';
      throw error;
    }
    this.validation = Object.freeze({ ...result, ok: true });
    this.state = 'validated';
    return this;
  }

  publish() {
    if (this.state !== 'validated') throw new Error('Only a validated bundle can be published');
    this.state = 'active';
    return this;
  }

  park() {
    if (this.state !== 'active') throw new Error('Only an active bundle can be parked');
    this.state = 'parked';
    return this;
  }

  dispose() {
    if (this.state === 'disposed') return;
    for (const { resource, shared, dispose } of [...this.resources.values()].reverse()) {
      if (shared) this.registry.release(resource);
      else (dispose || ((value) => value?.dispose?.()))(resource);
    }
    this.resources.clear();
    this.state = 'disposed';
  }

  get(name) { return this.resources.get(name)?.resource || null; }
}
