import { describe, expect, it } from 'vitest'
import { fromYaml } from '../expr'
import { imageRef } from './imageCell'

describe('imageRef: the file an Image cell shows (YAZ-4954 part 2)', () => {
  it('a link to a picture whose words look like an ID names the picture, in either order', () => {
    expect(imageRef(fromYaml('[[photo.png|FIG-1]]'))).toBe('photo.png')
    expect(imageRef(fromYaml('[[FIG-1|assets/photo.png]]'))).toBe('assets/photo.png')
    expect(imageRef('[[photo.png|FIG-1]]')).toBe('photo.png')
  })
})
