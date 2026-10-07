import { describe, expect, it } from 'vitest';
import { isLocalMongo, mongoHost } from '../localOnly.js';

/** The seed scripts' guard: which connection strings count as this machine. Hosts are synthetic. */
describe('isLocalMongo', () => {
  it('reads the host out of every shape of connection string', () => {
    expect(mongoHost('mongodb://localhost:27017/saar')).toBe('localhost');
    expect(mongoHost('mongodb://user:p%40ss@127.0.0.1:27017/saar?authSource=admin')).toBe('127.0.0.1');
    expect(mongoHost('mongodb+srv://user:secret@cluster0.example.mongodb.net/saar')).toBe(
      'cluster0.example.mongodb.net',
    );
    expect(mongoHost('mongodb://a.example.net:27017,b.example.net:27017/saar?replicaSet=rs')).toBe('a.example.net');
    expect(mongoHost('mongodb://[::1]:27017/saar')).toBe('[::1]');
  });

  it('allows only this machine', () => {
    expect(isLocalMongo('mongodb://localhost:27017/saar')).toBe(true);
    expect(isLocalMongo('mongodb://127.0.0.1/saar')).toBe(true);
    expect(isLocalMongo('mongodb://[::1]:27017/saar')).toBe(true);
    expect(isLocalMongo('mongodb+srv://u:p@cluster0.example.mongodb.net/saar')).toBe(false);
    /* A password containing "localhost" must not fool it. */
    expect(isLocalMongo('mongodb+srv://u:localhost@cluster0.example.mongodb.net/saar')).toBe(false);
  });
});
