# Test faces

Source: https://thispersondoesnotexist.com (image at /random-person.jpeg). These are StyleGAN2-generated faces. None of them depict real people.

Checklist for judging likeness (one line per face):

- **face-1.jpg**: Adult man, about 30, light skin, short dark-brown tousled hair, light-brown stubble beard, smiling, slate-blue background, no glasses.
- **face-2.jpg**: Girl, about 8-10, light skin with rosy cheeks, light-brown shoulder-length wavy hair, slight closed-mouth smile, pale grey background, no glasses.
- **face-3.jpg**: Woman, about 50-55, medium-tan skin, short dark-brown hair, thin metal rectangular glasses, big smile, small dark earring, green foliage background.
- **face-4.jpg**: Woman, about 25-30, light skin, long straight brown hair past the shoulders, green eyes, neutral serious expression, blurred green background, no glasses.
- **face-5.jpg**: Man, about 30, medium-tan skin, short dark wavy hair, bright smile, dark green foliage background, green collar, no glasses.
- **face-6.jpg**: Man, about 60-65, light skin with weathered wrinkles, short grey hair, thin rectangular metal glasses, friendly smile, grey background, light collared shirt, no facial hair.

Coverage gap: none of the 50 candidates from this source had dark skin (its training data skews light). face-7.jpg will be a dark-skinned adult generated as a photorealistic portrait of a non-existent person by the image model itself; see TESTING.md.
