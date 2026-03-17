import os
import pika
import json
import sys

def publish_to_rabbitmq(job_id: int):
    """Publish a job ID to the RabbitMQ task queue."""
    try:
        rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
        rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
        rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
        credentials = pika.PlainCredentials(rabbitmq_user, rabbitmq_pass)
        connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host, credentials=credentials))
        channel = connection.channel()

        queue_name = 'migration_tasks'
        channel.queue_declare(queue=queue_name, durable=True)

        message = json.dumps({'job_id': str(job_id)})
        channel.basic_publish(
            exchange='',
            routing_key=queue_name,
            body=message,
            properties=pika.BasicProperties(
                delivery_mode=2,  # make message persistent
            ))
        print(f" [x] Sent job '{job_id}' to RabbitMQ")
        connection.close()
    except Exception as e:
        # If RabbitMQ fails, we don't want to fail the whole request,
        # but we should log it. The DB-polling worker could still pick it up.
        print(f" [!] Failed to send job '{job_id}' to RabbitMQ: {e}", file=sys.stderr)
