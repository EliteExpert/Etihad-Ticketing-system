import os
import json
import random
import string
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
import barcode
from barcode.writer import ImageWriter

app = Flask(__name__)
CORS(app)

class BoardingPassGenerator:
    def __init__(self, template_path, shift_left=0):
        self.template = Image.open(template_path)
        self.draw = ImageDraw.Draw(self.template)
        self.shift_left = shift_left
        
        # Coordinates for text placement
        original_coordinates = {
            "flight": (60, 262),
            "departure_date": (180, 262),
            "departure_time": (370, 262),
            "passenger_name": (60, 330),
            "seat": (300, 413),
            "zone": (434, 413),
            "boarding_at": (134, 497),
            "gate_closes_at": (320, 497),
            "departing_from": (131, 591),
            "arriving_at": (131, 686),
            "skywards_number": (85, 799),
            "additional_info": (290, 799),
            "ticket_number": (180, 950),
            "barcode": (135, 977)
        }
        
        self.coordinates = {}
        for field, (x, y) in original_coordinates.items():
            self.coordinates[field] = (x - shift_left, y)
        
        self._init_fonts()
    
    def _init_fonts(self):
        font_sizes = {
            "passenger_name": 20,
            "airport_codes": 28,
            "flight_info": 22,
            "boarding_info": 22,
            "small_text": 20,
            "ticket_number": 22,
            "barcode_text": 18
        }
        
        self.fonts = {}
        
        font_paths = [
            "arial.ttf",
            "arialbd.ttf",
            "Arial.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf"
        ]
        
        for font_path in font_paths:
            try:
                for font_type, size in font_sizes.items():
                    self.fonts[font_type] = ImageFont.truetype(font_path, size)
                break
            except:
                continue
        else:
            for font_type in font_sizes.keys():
                self.fonts[font_type] = ImageFont.load_default()
    
    def generate_ticket_number(self, airline_code="074"):
        """Generate a dynamic ticket number in format: 074-1234567890"""
        random_digits = ''.join(random.choices(string.digits, k=10))
        ticket_number = f"{airline_code}-{random_digits}"
        return ticket_number
    
    def generate_random_seat(self, class_type):
        """Generate a random seat number based on class"""
        class_type = str(class_type).lower()
        
        if class_type in ["first", "first class"]:
            rows = ["1", "2", "3", "4", "5", "6"]
            seats = ["A", "B", "C", "D"]  # First class configuration
        elif class_type in ["business", "business class"]:
            rows = ["2", "3", "4", "5", "6", "7", "8", "9"]
            seats = ["A", "B", "C", "D"]  # Business class configuration
        else:  # economy
            rows = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", 
                    "21", "22"]
            seats = ["A", "B", "C", "D", "E", "F"]  # Economy configuration
        
        row = random.choice(rows)
        seat = random.choice(seats)
        return f"{row}{seat}"
    
    def generate_barcode(self, barcode_data):
        try:
            code128 = barcode.get_barcode_class('code128')
            
            writer = ImageWriter()
            writer.set_options({
                'module_width': 0.15,
                'module_height': 12,
                'font_size': 0,
                'text_distance': 0.3,
                'quiet_zone': 1,
                'write_text': False
            })
            
            barcode_image = code128(barcode_data, writer=writer)
            
            barcode_bytes = BytesIO()
            barcode_image.write(barcode_bytes)
            barcode_bytes.seek(0)
            
            barcode_img = Image.open(barcode_bytes).convert('RGB')
            
            target_width = 250
            target_height = 75
            
            barcode_img = barcode_img.resize((target_width, target_height), Image.Resampling.LANCZOS)
            
            x, y = self.coordinates["barcode"]
            
            self.template.paste(barcode_img, (x, y))
            
            return barcode_data
            
        except Exception as e:
            print(f"Barcode error: {e}")
            return None
    
    def add_text(self, field, value):
        if field not in self.coordinates or not value:
            return
        
        x, y = self.coordinates[field]
        
        font_map = {
            "passenger_name": "passenger_name",
            "departing_from": "airport_codes",
            "arriving_at": "airport_codes",
            "flight": "flight_info",
            "departure_date": "flight_info",
            "departure_time": "flight_info",
            "seat": "boarding_info",
            "zone": "boarding_info",
            "boarding_at": "boarding_info",
            "gate_closes_at": "boarding_info",
            "skywards_number": "small_text",
            "additional_info": "small_text",
            "ticket_number": "ticket_number"
        }
        
        font_type = font_map.get(field, "small_text")
        font = self.fonts.get(font_type, self.fonts["small_text"])
        
        self.draw.text((x, y), str(value), fill=(50, 50, 50), font=font)
    
    def generate_from_data(self, data, airline_code="074"):

        ticket_number = self.generate_ticket_number(airline_code)
        
        barcode_data = ticket_number.replace("-", "")
        
        data['ticket_number'] = ticket_number
        
        fields = [
            "flight", "departure_date", "departure_time",
            "passenger_name",
            "seat", "zone", "boarding_at", "gate_closes_at",
            "departing_from", "arriving_at",
            "skywards_number", "additional_info",
            "ticket_number"
        ]
        
        for field in fields:
            if field in data:
                self.add_text(field, data[field])
        

        self.generate_barcode(barcode_data)
        
        return ticket_number, barcode_data

def get_template_path(class_type):
    """Return the appropriate template based on travel class"""
    class_type = str(class_type).lower().strip()
    
    if class_type in ["business", "business class", "j", "c"]:
        return "template2.png"
    elif class_type in ["first", "first class", "f", "a"]:
        return "template3.png"
    else:  # economy or default
        return "template.png"


os.makedirs('uploads', exist_ok=True)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "boarding-pass-api"}), 200

@app.route('/generate-boarding-pass', methods=['POST'])
def generate_boarding_pass():
    try:
        data = request.json
        
        if 'passenger_name' not in data:
            return jsonify({
                "error": "Missing required field: passenger_name",
                "success": False
            }), 400
        
        class_type = data.get('class', 'economy').lower()
        
        template_path = get_template_path(class_type)
        
        if not os.path.exists(template_path):
            return jsonify({
                "error": f"Template not found: {template_path}",
                "available_templates": ["template.png", "template2.png", "template3.png"]
            }), 404
        

        generator = BoardingPassGenerator(template_path)
        
        flight = data.get('flight', 'EK 202')
        airline_code = "074" 
        

        if flight and len(flight.split()) > 0:
            flight_prefix = flight.split()[0]
            airline_codes = {
                'EK': '074', 'QF': '081', 'AA': '001', 'BA': '125',
                'DL': '006', 'UA': '016', 'LH': '220', 'AF': '057'
            }
            airline_code = airline_codes.get(flight_prefix.upper(), '074')
        

        current_seat = data.get('seat', '')
        default_seats = ['12A', '2A', '1A']
        
        if current_seat in default_seats or current_seat == '':

            random_seat = generator.generate_random_seat(class_type)
            data['seat'] = random_seat
            print(f"Generated random seat: {random_seat} for {class_type} class")
        
        ticket_number, barcode_data = generator.generate_from_data(data, airline_code)
        

        safe_ticket = ticket_number.replace("-", "_")
        safe_name = data['passenger_name'].replace(" ", "_")[:50]
        filename = f"boarding_pass_{safe_name}_{safe_ticket}.png"
        filepath = f"uploads/{filename}"
        
        generator.template.save(filepath)
        
        base_url = request.host_url.rstrip('/')
        image_url = f"{base_url}/uploads/{filename}"
        
        return jsonify({
            "success": True,
            "ticket_number": ticket_number,
            "barcode_data": barcode_data,
            "image_url": image_url,
            "download_url": f"{base_url}/download/{safe_ticket}",
            "filename": filename,
            "passenger_name": data['passenger_name'],
            "class": class_type,
            "flight": data.get('flight', 'EK 202'),
            "departure_date": data.get('departure_date', '15 DEC 2024'),
            "departure_time": data.get('departure_time', '14:30'),
            "seat": data.get('seat', '')
        }), 200
        
    except Exception as e:
        return jsonify({
            "error": str(e),
            "success": False
        }), 500

@app.route('/download/<ticket_number>', methods=['GET'])
def download_boarding_pass(ticket_number):
    """Download boarding pass by ticket number"""
    try:

        files = os.listdir('uploads')
        target_file = None
        
        for file in files:
            if ticket_number.replace("_", "-") in file:
                target_file = file
                break
        
        if not target_file:
            return jsonify({"error": "Ticket not found"}), 404
        
        filepath = f"uploads/{target_file}"
        return send_file(filepath, mimetype='image/png', as_attachment=True, download_name=target_file)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/uploads/<filename>', methods=['GET'])
def serve_image(filename):
    """Serve the generated image"""
    try:
        return send_file(f"uploads/{filename}", mimetype='image/png')
    except Exception as e:
        return jsonify({"error": str(e)}), 404

@app.route('/templates', methods=['GET'])
def list_templates():
    """List available templates"""
    templates = [
        {"name": "template.png", "class": "economy", "exists": os.path.exists("template.png")},
        {"name": "template2.png", "class": "business", "exists": os.path.exists("template2.png")},
        {"name": "template3.png", "class": "first", "exists": os.path.exists("template3.png")}
    ]
    
    return jsonify({
        "templates": templates,
        "instructions": "Use 'class' parameter in POST request to select template: economy, business, or first"
    }), 200

@app.route('/status', methods=['GET'])
def api_status():
    """Check API status"""
    uploads_dir = 'uploads'
    upload_count = len(os.listdir(uploads_dir)) if os.path.exists(uploads_dir) else 0
    
    return jsonify({
        "status": "running",
        "service": "Boarding Pass Generator API",
        "uploaded_files": upload_count,
        "endpoints": {
            "POST /generate-boarding-pass": "Generate boarding pass (only passenger_name required)",
            "GET /download/<ticket>": "Download by ticket number",
            "GET /uploads/<filename>": "View image",
            "GET /templates": "List templates",
            "GET /health": "Health check"
        }
    }), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)

