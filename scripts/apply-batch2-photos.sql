-- Run ONLY after the deploy containing public/dishes/*.jpg is live.
UPDATE "Dish" SET "imageUrl"='/dishes/asian-healthy-bowl.jpg' WHERE name='Asian Healthy Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/chicken-doner.jpg' WHERE name='Chicken Doner';
UPDATE "Dish" SET "imageUrl"='/dishes/chicken-tikka-masala-with-naan-rice-kachumber-salad.jpg' WHERE name='Chicken Tikka Masala with Naan, Rice & Kachumber Salad';
UPDATE "Dish" SET "imageUrl"='/dishes/japanese-chicken-curry-bowl.jpg' WHERE name='Japanese Chicken Curry Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/japanese-vegetable-curry-bowl.jpg' WHERE name='Japanese Vegetable Curry Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/thai-curry-chicken-bowl.jpg' WHERE name='Thai Curry Chicken Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/homemade-beef-lasagne.jpg' WHERE name='Homemade Beef Lasagne';
-- Added after owner rule: one shared image for meat+veg variants is fine when the image shows no meat
UPDATE "Dish" SET "imageUrl"='/dishes/asian-salad.jpg' WHERE name='Asian Salad with Chicken';
UPDATE "Dish" SET "imageUrl"='/dishes/asian-salad.jpg' WHERE name='Asian Salad with Chilli Tofu';
UPDATE "Dish" SET "imageUrl"='/dishes/cranberry-avocado-salad.jpg' WHERE name='Cranberry Avocado & Chicken Salad';
UPDATE "Dish" SET "imageUrl"='/dishes/cranberry-avocado-salad.jpg' WHERE name='Cranberry Avocado Salad with Jackfruit Pumpkin Patty';
UPDATE "Dish" SET "imageUrl"='/dishes/fiesta-salad.jpg' WHERE name='Fiesta Salad with Chicken';
UPDATE "Dish" SET "imageUrl"='/dishes/fiesta-salad.jpg' WHERE name='Fiesta Salad with No Chicken Chicken';
UPDATE "Dish" SET "imageUrl"='/dishes/chicken-dirty-fries.jpg' WHERE name='Chicken Dirty Fries';
UPDATE "Dish" SET "imageUrl"='/dishes/stir-fry-noodle-bowl.jpg' WHERE name='Stir-Fry Noodle Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/stir-fry-noodle-bowl.jpg' WHERE name='Stir-Fry Chicken Noodle Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/stir-fry-noodle-bowl.jpg' WHERE name='Stir-Fry Pork Noodle Bowl';
UPDATE "Dish" SET "imageUrl"='/dishes/enchiladas.jpg' WHERE name='Chicken Enchiladas';
UPDATE "Dish" SET "imageUrl"='/dishes/enchiladas.jpg' WHERE name='Vegetable Enchiladas';
UPDATE "Dish" SET "imageUrl"='/dishes/burrito.jpg' WHERE name='Chicken Tinga Burrito';
UPDATE "Dish" SET "imageUrl"='/dishes/burrito.jpg' WHERE name='Barbacoa Beef Burrito';
UPDATE "Dish" SET "imageUrl"='/dishes/burrito.jpg' WHERE name='Jackfruit Tinga Burrito';
UPDATE "Dish" SET "imageUrl"='/dishes/burrito.jpg' WHERE name='Vegetable Chilli Burrito';
UPDATE "Dish" SET "imageUrl"='/dishes/jackfruit-pumpkin-burger.jpg' WHERE name='Chicken Burger';
